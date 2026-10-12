import asyncio
import math
import struct
import time
import logging
from typing import Any
from pymodbus.framer import FramerType
from adapters.base import Reading
from control_guard import ControlUnavailable
from protocol_trace import TRACE

import config

_log = logging.getLogger(__name__)


def _bcd_decode(raw: int) -> int:
    """BCD 인코딩된 정수를 10진수로 변환. 예: 0x0212 → 212."""
    result = 0
    factor = 1
    while raw:
        result += (raw & 0xF) * factor
        raw >>= 4
        factor *= 10
    return result


class ModbusAdapter:
    """
    MODBUS TCP/RTU 어댑터 (Diedrich, Easyster, Proaster, Trinitas, Probat Probatone, Loring).
    pymodbus 3.x AsyncModbusTcpClient / AsyncModbusSerialClient 사용.

    mode="tcp" → TCP (host, port)
    mode="udp" → UDP (host, port) — Artisan type=4
    mode="rtu" → Serial RTU (comport, baudrate)
    mode="ascii" → Serial ASCII (comport, baudrate) — Artisan type=1 장치

    modbus_registers: roaster_registry의 "modbus_registers" 필드.
      {
        "BT": {"register": N, "func": 1|2|3|4, "unit_id": N,
               "float": bool, "div": 0|1|2, "mode": "C"|"F",
               "signed": bool},
        "ET": {...} or None,
      }
    func=1 → Read Coils           (bit)
    func=2 → Read Discrete Inputs (bit)
    func=3 → Read Holding Registers
    func=4 → Read Input Registers
    float=True  → 2레지스터 IEEE 32-bit float (Diedrich CR/DR)
    div=1  → ÷10, div=2 → ÷100
    mode="F" → °F → °C 변환 (Diedrich, Loring)
    signed=True → 16-bit signed integer 해석

    word_order="little" (기본) → Artisan wordorderLittle=True와 동일.
                                  float 2레지스터를 [low, high] 순서로 해석.
    word_order="big"           → [high, low] 순서.
    """

    def __init__(
        self,
        mode: str = "tcp",
        host: str = "127.0.0.1",
        port: int = 502,
        comport: str = "",
        baudrate: int = 9600,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: float = 1,
        interval: float = 1.0,
        word_order: str = "little",
        byte_order: str = "big",
        modbus_registers: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        self._mode = mode.lower()
        self._host = host
        self._port = port
        self._comport = comport
        self._baudrate = baudrate
        self._bytesize = bytesize
        self._parity = parity
        self._stopbits = int(stopbits)
        self._interval = interval
        self._word_order = word_order.lower() if isinstance(word_order, str) else ""
        self._byte_order = byte_order.lower() if isinstance(byte_order, str) else ""
        self._regs: dict[str, Any] = modbus_registers or {}
        self._validate_registers()
        self._extra_cursor = 0
        self._client: Any = None
        # Artisan 기본값: TCP readRetries=0, serial_readRetries=1.
        # 우리도 동일하게 모드별 차등 — 500ms 폴링 사이클 안에 들어오도록.
        # TODO(T36): RTU는 시리얼 응답이 본질적으로 느려서 500ms 폴링에는 빠듯함.
        #   채널 3개 retry 한 번 들어가면 worst-case 1.8s → 폴링 cycle 누락 가능.
        #   UI에서 RTU 머신 선택 시 pollIntervalMs를 자동으로 1000ms로 올리는 옵션 필요.
        #   (artisan 권장도 RTU=1s 폴링)
        # tcp/udp도 1회 재시도: Wi-Fi 브리지 등에서 250ms 스파이크 한 번에 read가
        # 실패하지 않도록. worst-case 5레지스터 × 2회 × 0.25s = 2.5s < READ_TIMEOUT 3s.
        self._read_retries: int = 1

    def _validate_registers(self) -> None:
        if self._word_order not in {"big", "little"} or self._byte_order not in {"big", "little"}:
            raise ValueError("word_order and byte_order must be 'big' or 'little'")
        if sum(channel is not None for channel in self._regs.values()) > 128:
            raise ValueError("modbus_registers supports at most 128 channels")
        for role, channel in self._regs.items():
            if not isinstance(role, str) or not role or len(role) > 64:
                raise ValueError("modbus channel id must be a non-empty string up to 64 characters")
            if channel is None:
                continue
            if not isinstance(channel, dict):
                raise ValueError(f"modbus channel {role} must be an object")
            for field, low, high in (("register", 0, 65535), ("func", 1, 4), ("unit_id", 0, 247), ("div", 0, 9)):
                value = channel.get(field, 0 if field == "div" else None)
                if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                    raise ValueError(f"modbus channel {role}.{field} must be an integer from {low} to {high}")
            for field in ("word_order", "byte_order"):
                if field in channel and channel[field] not in {"big", "little"}:
                    raise ValueError(f"modbus channel {role}.{field} must be 'big' or 'little'")
            if "preserve_precision" in channel and not isinstance(
                channel["preserve_precision"], bool
            ):
                raise ValueError(f"modbus channel {role}.preserve_precision must be boolean")
            if (channel.get("float") or channel.get("bcd")) and channel["register"] == 65535:
                raise ValueError(f"modbus channel {role}.register cannot fit two registers")
            compensation = channel.get("compensation", 0)
            if (
                isinstance(compensation, bool)
                or not isinstance(compensation, (int, float))
                or not math.isfinite(compensation)
                or not -1_000_000 <= compensation <= 1_000_000
            ):
                raise ValueError(f"modbus channel {role}.compensation must be finite")
            for field in ("label", "unit"):
                if field in channel and (not isinstance(channel[field], str) or len(channel[field]) > 1024):
                    raise ValueError(f"modbus channel {role}.{field} must be a string up to 1024 characters")

    async def connect(self) -> None:
        from pymodbus.client import (  # type: ignore[import]
            AsyncModbusSerialClient,
            AsyncModbusTcpClient,
            AsyncModbusUdpClient,
        )

        if not self._regs:
            raise ValueError(
                "modbus_registers가 비어 있음. roaster_registry 확인 필요."
            )

        if self._mode in ("rtu", "ascii"):
            if not isinstance(self._comport, str) or not self._comport.strip():
                raise ValueError(
                    "Modbus 시리얼 연결에는 Serial Port가 필요합니다. 기기 설정에서 포트를 입력하세요."
                )

        if self._mode == "tcp":
            self._client = AsyncModbusTcpClient(
                host=self._host, port=self._port, timeout=config.MODBUS_TCP_TIMEOUT
            )
            _log.info(
                "ModbusAdapter connecting: TCP %s:%d timeout=%.1fs",
                self._host,
                self._port,
                config.MODBUS_TCP_TIMEOUT,
            )
        elif self._mode == "udp":
            self._client = AsyncModbusUdpClient(
                host=self._host,
                port=self._port,
                # Artisan: UDP는 retries>0이면 요청이 n번 중복 전송됨 → 반드시 0
                retries=0,
                timeout=config.MODBUS_TCP_TIMEOUT,
            )
            _log.info(
                "ModbusAdapter connecting: UDP %s:%d timeout=%.1fs",
                self._host,
                self._port,
                config.MODBUS_TCP_TIMEOUT,
            )
        else:
            framer = FramerType.ASCII if self._mode == "ascii" else FramerType.RTU
            self._client = AsyncModbusSerialClient(
                port=self._comport,
                framer=framer,
                baudrate=self._baudrate,
                bytesize=self._bytesize,
                parity=self._parity,
                stopbits=self._stopbits,
                timeout=config.MODBUS_RTU_TIMEOUT,
            )
            _log.info(
                "ModbusAdapter connecting: Serial %s port=%s baudrate=%d bytesize=%d parity=%s stopbits=%g timeout=%.1fs",
                framer.name,
                self._comport,
                self._baudrate,
                self._bytesize,
                self._parity,
                self._stopbits,
                config.MODBUS_RTU_TIMEOUT,
            )

        is_net = self._mode in ("tcp", "udp")
        await self._client.connect()
        if not self._client.connected:
            raise ConnectionError(
                f"MODBUS 연결 실패: "
                f"{'%s:%d' % (self._host, self._port) if is_net else self._comport}"
            )
        if is_net:
            await asyncio.sleep(0.3)  # Artisan: "avoid possible hickups on startup"
        else:
            await asyncio.sleep(config.MODBUS_RTU_CONNECT_DELAY)
        _log.info("ModbusAdapter connected OK (mode=%s)", self._mode)

    async def disconnect(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            try:
                # 불량 시리얼 포트에서 close()가 행하면 이후 모든 lock이 막힌다
                await asyncio.wait_for(
                    asyncio.to_thread(client.close),
                    timeout=config.MODBUS_CLOSE_TIMEOUT,
                )
            except Exception as exc:
                _log.warning("MODBUS close 실패/타임아웃 (무시): %s", exc)

    async def _read_channel(
        self, cfg: dict[str, Any], *, preserve_precision: bool = False
    ) -> float:
        """단일 채널(BT 또는 ET) 읽기. retry 포함."""
        register: int = cfg["register"]
        func: int = cfg["func"]
        unit_id: int = cfg["unit_id"]
        is_float: bool = cfg.get("float", False)
        div: int = cfg.get("div", 0)
        temp_mode: str = cfg.get("mode", "C")
        word_order: str = cfg.get("word_order", self._word_order)
        byte_order: str = cfg.get("byte_order", self._byte_order)
        compensation: float = cfg.get("compensation", 0)
        is_signed: bool = cfg.get("signed", False)
        # func=1/2(bit): count=1, func=3/4: float/bcd(32bit)→2, bcd16/int→1
        is_bcd32 = cfg.get("bcd", False)
        is_bcd16 = cfg.get("bcd_as_int", False)
        count = 1 if func in (1, 2) else (2 if (is_float or is_bcd32) else 1)

        last_exc: Exception = RuntimeError("MODBUS 읽기 실패")
        for attempt in range(self._read_retries + 1):
            try:
                _log.debug(
                    "READ attempt %d: func=%d register=%d(0x%04X) count=%d unit=%d",
                    attempt + 1,
                    func,
                    register,
                    register,
                    count,
                    unit_id,
                )
                TRACE.record(
                    "tx", "modbus",
                    f"func={func} register={register}(0x{register:04X}) count={count} unit={unit_id}",
                )
                if func == 1:
                    result = await self._client.read_coils(
                        register, count=count, device_id=unit_id
                    )
                elif func == 2:
                    result = await self._client.read_discrete_inputs(
                        register, count=count, device_id=unit_id
                    )
                elif func == 3:
                    result = await self._client.read_holding_registers(
                        register, count=count, device_id=unit_id
                    )
                else:
                    result = await self._client.read_input_registers(
                        register, count=count, device_id=unit_id
                    )

                if result.isError():
                    raise IOError(
                        f"MODBUS 오류 응답: func={func} register={register} unit={unit_id} → {result}"
                    )

                # func=1/2: bit 반환
                if func in (1, 2):
                    TRACE.record("rx", "modbus", f"register={register} bits", list(result.bits[:count]))
                    _log.debug("READ OK: bits=%s", result.bits)
                    if not result.bits:
                        raise IOError(f"MODBUS empty bit response at register {register}")
                    value = float(result.bits[0])
                else:
                    TRACE.record("rx", "modbus", f"register={register} raw", list(result.registers))
                    _log.debug("READ OK: registers=%s", result.registers)

                if func not in (1, 2) and is_float:
                    # word_order="little": [low_word, high_word] → 스왑 후 big-endian unpack
                    if word_order == "little":
                        raw = struct.pack(
                            ">HH", result.registers[1], result.registers[0]
                        )
                    else:
                        raw = struct.pack(
                            ">HH", result.registers[0], result.registers[1]
                        )
                    value = struct.unpack("<f" if byte_order == "little" else ">f", raw)[0]
                elif func not in (1, 2):
                    if is_bcd32:
                        # 32-bit BCD: 2 registers (Artisan inputBCDs, Loring temp channels)
                        if word_order == "little":
                            raw32 = (result.registers[1] << 16) | result.registers[0]
                        else:
                            raw32 = (result.registers[0] << 16) | result.registers[1]
                        raw_int = _bcd_decode(raw32)
                    elif is_bcd16:
                        # 16-bit BCD: 1 register (Artisan inputBCDsAsInt, Loring drum %)
                        raw_int = _bcd_decode(result.registers[0])
                    elif is_signed and result.registers[0] >= 0x8000:
                        raw_int = result.registers[0] - 0x10000
                    else:
                        raw_int = result.registers[0]

                    value = float(raw_int)

                value /= 10.0 ** div

                if temp_mode == "F":
                    value = (value - 32.0) * 5.0 / 9.0
                value += compensation
                if not math.isfinite(value):
                    raise ValueError("decoded MODBUS value is not finite")

                preserve_precision = preserve_precision or cfg.get("preserve_precision", False)
                if not preserve_precision and cfg.get("unit") not in ("%", "Pa", "Hz", "RPM"):
                    value = round(value, 1)
                TRACE.record(
                    "info", "modbus",
                    f"decoded register={register} float={is_float} bcd32={is_bcd32} "
                    f"bcd16={is_bcd16} signed={is_signed} div={div} mode={temp_mode} "
                    f"word_order={word_order} byte_order={byte_order}",
                    value,
                )
                return value
            except Exception as exc:
                last_exc = exc
                TRACE.record("err", "modbus", f"register={register} attempt={attempt + 1}: {exc}")
                _log.warning(
                    "MODBUS 읽기 실패 (attempt %d/%d): register=%d unit=%d — %s",
                    attempt + 1,
                    self._read_retries + 1,
                    register,
                    unit_id,
                    exc,
                )
        raise last_exc

    async def read(self) -> Reading:
        if self._client is None or not self._client.connected:
            raise ConnectionError("MODBUS 클라이언트가 연결되지 않음")

        bt_cfg = self._regs.get("BT")
        et_cfg = self._regs.get("ET")
        heater_cfg = self._regs.get("heater")
        fan_cfg = self._regs.get("fan")
        drum_cfg = self._regs.get("drum")
        deadline = time.monotonic() + config.READ_TIMEOUT * 0.95

        bt = await self._read_channel(bt_cfg) if bt_cfg else -1.0
        et = await self._read_channel(et_cfg) if et_cfg else -1.0
        heater = await self._read_channel(heater_cfg) if heater_cfg else None  # 레지스터 없음 = 채널 없음
        fan = await self._read_channel(fan_cfg) if fan_cfg else 0.0
        drum = await self._read_channel(drum_cfg) if drum_cfg else 0.0

        extras = [
            (role, cfg)
            for role, cfg in self._regs.items()
            if role not in {"BT", "ET", "heater", "fan", "drum"} and cfg
        ]
        values: dict[str, float | None] = {}
        start = self._extra_cursor % len(extras) if extras else 0
        if extras:
            self._extra_cursor = (start + 1) % len(extras)
        for role, cfg in [*extras[start:], *extras[:start]]:
            value: float | None = None
            remaining = deadline - time.monotonic()
            if remaining > 0:
                try:
                    value = await asyncio.wait_for(
                        self._read_channel(cfg, preserve_precision=True), remaining
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    _log.warning("Optional MODBUS channel %s unavailable: %s", role, exc)
            values[role] = value
        extra_readings = [
            {
                "id": role,
                "label": cfg.get("label") or role,
                "unit": cfg.get("unit", ""),
                "value": values.get(role),
            }
            for role, cfg in extras
        ]

        return Reading(
            bt=bt,
            et=et,
            heater=heater,
            fan=fan,
            drum=drum,
            timestamp=time.monotonic(),
            extra_readings=extra_readings,
        )

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.connected

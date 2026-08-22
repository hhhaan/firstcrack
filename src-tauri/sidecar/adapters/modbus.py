import asyncio
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
        self._word_order = word_order.lower()  # "little" | "big"
        self._regs: dict[str, Any] = modbus_registers or {}
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

    async def _read_channel(self, cfg: dict[str, Any]) -> float:
        """단일 채널(BT 또는 ET) 읽기. retry 포함."""
        register: int = cfg["register"]
        func: int = cfg["func"]
        unit_id: int = cfg["unit_id"]
        is_float: bool = cfg.get("float", False)
        div: int = cfg.get("div", 0)
        temp_mode: str = cfg.get("mode", "C")
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
                    return float(result.bits[0]) if result.bits else 0.0

                TRACE.record("rx", "modbus", f"register={register} raw", list(result.registers))
                _log.debug("READ OK: registers=%s", result.registers)

                if is_float:
                    # word_order="little": [low_word, high_word] → 스왑 후 big-endian unpack
                    if self._word_order == "little":
                        raw = struct.pack(
                            ">HH", result.registers[1], result.registers[0]
                        )
                    else:
                        raw = struct.pack(
                            ">HH", result.registers[0], result.registers[1]
                        )
                    value = struct.unpack(">f", raw)[0]
                else:
                    if is_bcd32:
                        # 32-bit BCD: 2 registers (Artisan inputBCDs, Loring temp channels)
                        if self._word_order == "little":
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

                    if div == 1:
                        value /= 10.0
                    elif div == 2:
                        value /= 100.0

                if temp_mode == "F":
                    value = (value - 32.0) * 5.0 / 9.0

                value = round(value, 1)
                TRACE.record(
                    "info", "modbus",
                    f"decoded register={register} float={is_float} bcd32={is_bcd32} "
                    f"bcd16={is_bcd16} signed={is_signed} div={div} mode={temp_mode} "
                    f"word_order={self._word_order}",
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

        bt = await self._read_channel(bt_cfg) if bt_cfg else -1.0
        et = await self._read_channel(et_cfg) if et_cfg else -1.0
        heater = await self._read_channel(heater_cfg) if heater_cfg else 0.0
        fan = await self._read_channel(fan_cfg) if fan_cfg else 0.0
        drum = await self._read_channel(drum_cfg) if drum_cfg else 0.0

        return Reading(
            bt=bt, et=et, heater=heater, fan=fan, drum=drum, timestamp=time.monotonic()
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

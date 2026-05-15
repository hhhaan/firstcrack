import struct
import time
import logging
from typing import Any

from adapters.base import Reading

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
    MODBUS TCP/RTU 어댑터 (Diedrich, Easyster, Proaster, Trinitas, Probat Probatone).
    pymodbus 3.x AsyncModbusTcpClient / AsyncModbusSerialClient 사용.

    mode="tcp" → TCP (host, port)
    mode="rtu" → Serial RTU (comport, baudrate)

    modbus_registers: roaster_registry의 "modbus_registers" 필드.
      {
        "BT": {"register": N, "func": 3|4, "unit_id": N, "float": bool, "div": 0|1|2, "mode": "C"|"F"},
        "ET": {...} or None,
      }
    func=3 → Holding Register
    func=4 → Input Register
    float=True → 2레지스터 IEEE 32-bit float (Diedrich CR/DR)
    div=1 → ÷10, div=2 → ÷100
    mode="F" → °F → °C 변환 (Diedrich)
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
        self._stopbits = stopbits
        self._interval = interval
        self._regs: dict[str, Any] = modbus_registers or {}
        self._client: Any = None
        self._read_retries: int = 1

    async def connect(self) -> None:
        from pymodbus.client import AsyncModbusTcpClient, AsyncModbusSerialClient  # type: ignore[import]

        if not self._regs:
            raise ValueError(
                "modbus_registers가 비어 있음. roaster_registry 확인 필요."
            )

        if self._mode == "tcp":
            self._client = AsyncModbusTcpClient(host=self._host, port=self._port)
        else:
            self._client = AsyncModbusSerialClient(
                port=self._comport,
                baudrate=self._baudrate,
                bytesize=self._bytesize,
                parity=self._parity,
                stopbits=self._stopbits,
                timeout=10,
            )

        if self._mode == "tcp":
            _log.info("ModbusAdapter connecting: TCP %s:%d", self._host, self._port)
        else:
            _log.info(
                "ModbusAdapter connecting: RTU port=%s baudrate=%d bytesize=%d parity=%s stopbits=%g timeout=%ds",
                self._comport,
                self._baudrate,
                self._bytesize,
                self._parity,
                self._stopbits,
                10,
            )
        await self._client.connect()
        if not self._client.connected:
            raise ConnectionError(
                f"MODBUS 연결 실패: "
                f"{'%s:%d' % (self._host, self._port) if self._mode == 'tcp' else self._comport}"
            )
        _log.info("ModbusAdapter connected OK (mode=%s)", self._mode)

    async def disconnect(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    async def _read_channel(self, cfg: dict[str, Any]) -> float:
        """단일 채널(BT 또는 ET) 읽기. retry 포함."""
        register: int = cfg["register"]
        func: int = cfg["func"]
        unit_id: int = cfg["unit_id"]
        is_float: bool = cfg.get("float", False)
        div: int = cfg.get("div", 0)
        temp_mode: str = cfg.get("mode", "C")
        count = 2 if is_float else 1

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
                if func == 3:
                    result = await self._client.read_holding_registers(
                        register,
                        count,
                        slave=unit_id,
                        # register, count=count, device_id=unit_id
                    )
                else:
                    result = await self._client.read_input_registers(
                        register,
                        count,
                        slave=unit_id,
                        # register, count=count, device_id=unit_id
                    )

                if result.isError():
                    raise IOError(
                        f"MODBUS 오류 응답: func={func} register={register} unit={unit_id} → {result}"
                    )

                _log.debug("READ OK: registers=%s", result.registers)
                if is_float:
                    raw = struct.pack(">HH", result.registers[0], result.registers[1])
                    value = struct.unpack(">f", raw)[0]
                else:
                    raw_int = result.registers[0]
                    if cfg.get("bcd", False):
                        raw_int = _bcd_decode(raw_int)
                    value = float(raw_int)
                    if div == 1:
                        value /= 10.0
                    elif div == 2:
                        value /= 100.0

                if temp_mode == "F":
                    value = (value - 32.0) * 5.0 / 9.0

                return round(value, 1)
            except Exception as exc:
                last_exc = exc
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
        drum_cfg = self._regs.get("drum")
        bt = await self._read_channel(bt_cfg) if bt_cfg else -1.0
        et = await self._read_channel(et_cfg) if et_cfg else -1.0
        drum = await self._read_channel(drum_cfg) if drum_cfg else 0.0
        return Reading(
            bt=bt, et=et, heater=0.0, fan=0.0, drum=drum, timestamp=time.monotonic()
        )

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        pass  # 대부분 읽기 전용. 제어 필요 시 write_register 확장.

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.connected

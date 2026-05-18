import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)

# extern/kaleido.py KaleidoPort timeouts: open=6s, init=6s → 넉넉히 15s
_CONNECT_TIMEOUT = 15.0
_CONNECT_POLL = 0.1


class KaleidoAdapter:
    """
    Kaleido 전용 드라이버 (extern/kaleido.py).
    mode="TCP"    → WebSocket (Network.aset, port 80)
    mode="Serial" → MODBUS RTU (Serial.aset, baudrate 57600)

    connect()은 extern/kaleido.py의 ws_initialize() (Ping→TU→SC) 완료를
    sid + TU 상태 폴링으로 확인한 뒤 반환한다.
    """

    def __init__(
        self,
        mode: str = "TCP",
        host: str = "127.0.0.1",
        port: int = 80,
        path: str = "ws",
        comport: str = "",
        baudrate: int = 57600,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: int = 1,
        timeout: float = 0.6,
        **_: Any,
    ) -> None:
        from extern.kaleido import KaleidoPort
        self._driver = KaleidoPort()
        self._mode = mode
        self._host = host
        self._port = port
        self._path = path
        self._comport = comport
        self._baudrate = baudrate
        self._bytesize = bytesize
        self._parity = parity
        self._stopbits = stopbits
        self._timeout = timeout
        self._connected: bool = False

    async def connect(self) -> None:
        serial = None
        if self._mode.lower() == "serial":
            if not self._comport:
                raise ValueError("Kaleido Serial 모드: comport가 비어 있음.")
            # extern/kaleido.py의 SerialSettings TypedDict 필드와 1:1 매칭.
            serial = {
                "port": self._comport,
                "baudrate": self._baudrate,
                "bytesize": self._bytesize,
                "stopbits": self._stopbits,
                "parity": self._parity,
                "timeout": self._timeout,
                "clear_HUPCL": False,
            }
        self._driver.start(
            mode="C",  # 온도 단위(C/F): roaster registry에서 항상 C 모드 가정
            host=self._host,
            port=self._port,
            path=self._path,
            serial=serial,
        )
        # ws_initialize()가 Ping→TU→SC 핸드셰이크를 백그라운드에서 수행.
        # sid와 TU가 모두 설정되면 초기화 완료.
        deadline = time.monotonic() + _CONNECT_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(_CONNECT_POLL)
            if self._driver.get_state("sid") is not None and self._driver.get_state("TU") is not None:
                self._connected = True
                _log.info("Kaleido connected (mode=%s, TU=%s)", self._mode, self._driver.get_state("TU"))
                return
        raise ConnectionError(f"Kaleido 핸드셰이크 타임아웃 ({_CONNECT_TIMEOUT}s): Ping→TU→SC 미완료")

    async def disconnect(self) -> None:
        self._driver.stop()
        self._connected = False

    async def read(self) -> Reading:
        bt, et, _sid = self._driver.getBTET()
        try:
            hp = float(self._driver.get_state("HP") or 0)
        except (KeyError, TypeError):
            hp = 0.0
        try:
            fc = float(self._driver.get_state("FC") or 0)  # fan: FC (not SM)
        except (KeyError, TypeError):
            fc = 0.0
        try:
            drum = float(self._driver.get_state("RC") or 0)  # drum: RC (not RL)
        except (KeyError, TypeError):
            drum = 0.0
        return Reading(bt=bt, et=et, heater=hp, fan=fc, drum=drum, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        # Artisan kaleidoSendMessage(target, value): HP=화력, FC=팬, RC=드럼 (모두 정수 %)
        if heater is not None:
            self._driver.send_msg("HP", str(int(round(float(heater)))))
        if fan is not None:
            self._driver.send_msg("FC", str(int(round(float(fan)))))
        if drum is not None:
            self._driver.send_msg("RC", str(int(round(float(drum)))))

    @property
    def connected(self) -> bool:
        return self._connected

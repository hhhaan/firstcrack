import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)


class KaleidoAdapter:
    """
    Kaleido 전용 드라이버 (extern/kaleido.py).
    mode="TCP"    → WebSocket (Network.aset, port 80)
    mode="Serial" → MODBUS RTU (Serial.aset, baudrate 57600)

    TODO: connect()의 sleep(1.0) 레이스 조건 개선 필요.
          KaleidoPort에 on_connect 콜백이 노출되면 콜백 기반으로 교체.
    """

    def __init__(
        self,
        mode: str = "TCP",
        host: str = "127.0.0.1",
        port: int = 80,
        path: str = "ws",
        comport: str = "",
        baudrate: int = 57600,
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
        self._connected: bool = False

    async def connect(self) -> None:
        self._driver.start(
            mode=self._mode,
            host=self._host,
            port=self._port,
            path=self._path,
        )
        await asyncio.sleep(1.0)  # TODO: 콜백 기반으로 교체
        self._connected = True
        _log.info("Kaleido connected (mode=%s)", self._mode)

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
            fc = float(self._driver.get_state("FC") or 0)
        except (KeyError, TypeError):
            fc = 0.0
        return Reading(bt=bt, et=et, heater=hp, fan=fc, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        if heater is not None:
            self._driver.setSV(float(heater))

    @property
    def connected(self) -> bool:
        return self._connected

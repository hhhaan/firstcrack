import math
import time
import logging
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)


def _build_default_profile() -> dict[str, Any]:
    times: list[float] = []
    temp1: list[float] = []
    temp2: list[float] = []
    for t in range(0, 781, 15):
        if t <= 90:
            bt = 200 - (48 * t) / 90
        elif t <= 180:
            bt = 152 + (4 * (t - 90)) / 90
        elif t <= 420:
            bt = 156 + (18 * (t - 180)) / 240
        elif t <= 660:
            bt = 174 + (19 * (t - 420)) / 240
        else:
            bt = 193 + (10 * (t - 660)) / 120
        et = 220.0 if t == 0 else (220 - (5 * t) / 90 if t <= 90 else 215 + math.sin(t / 300) * 0.8)
        times.append(float(t))
        temp1.append(round(et, 1))
        temp2.append(round(bt, 1))
    return {"mode": "C", "timex": times, "temp1": temp1, "temp2": temp2}


_DEFAULT_PROFILE = _build_default_profile()


class SimulatorAdapter:
    """개발/테스트용 가상 온도 데이터."""

    def __init__(self, mode: str = "C", **_: Any) -> None:
        from extern.simulator import Simulator
        self._sim = Simulator(mode=mode, profile=_DEFAULT_PROFILE)
        self._start_time: float = 0.0
        self._connected: bool = False

    async def connect(self) -> None:
        self._start_time = time.monotonic()
        self._connected = True
        _log.info("Simulator connected")

    async def disconnect(self) -> None:
        self._connected = False

    async def read(self) -> Reading:
        tx = time.monotonic() - self._start_time
        et, bt = self._sim.read(tx)
        return Reading(bt=bt, et=et, heater=0.0, fan=0.0, drum=0.0, timestamp=time.monotonic())

    async def start_roast(self) -> None:
        """Charge 버튼과 동기화 — 프로파일 재생을 UI 투입 시점부터 시작."""
        self._start_time = time.monotonic()

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        pass

    @property
    def connected(self) -> bool:
        return self._connected

"""
가상 로스팅 머신 시뮬레이터 — 개발/테스트용.

"""

import math
import time
import logging
from bisect import bisect_right
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)


# ── 선형 보간 ──────────────────────────────────────────────


def _interp(x: float, xp: list[float], fp: list[float]) -> float:
    """numpy.interp 와 동일한 선형 보간 (xp 는 오름차순 정렬)."""
    if x <= xp[0]:
        return fp[0]
    if x >= xp[-1]:
        return fp[-1]
    i = bisect_right(xp, x)  # xp[i-1] < x <= xp[i]
    x0, x1 = xp[i - 1], xp[i]
    y0, y1 = fp[i - 1], fp[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


# ── 기본 프로파일 ──────────────────────────────────────────


def _build_default_profile() -> dict[str, Any]:
    """0~780초(13분) 15초 간격 기본 로스팅 프로파일을 생성한다."""
    times: list[float] = []
    temp1: list[float] = []
    temp2: list[float] = []

    for t in range(0, 781, 15):
        # BT (Bean Temperature) — 5단계 구간별 선형 방정식
        if t <= 90:
            bt = 200 - (48 * t) / 90  # 예열: 200→152°C
        elif t <= 180:
            bt = 152 + (4 * (t - 90)) / 90  # 건조: 152→156°C
        elif t <= 420:
            bt = 156 + (18 * (t - 180)) / 240  # Maillard: 156→174°C
        elif t <= 660:
            bt = 174 + (19 * (t - 420)) / 240  # 1C~개발: 174→193°C
        else:
            bt = 193 + (10 * (t - 660)) / 120  # 최종: 193→203°C

        # ET (Environment Temperature)
        if t == 0:
            et = 220.0
        elif t <= 90:
            et = 220 - (5 * t) / 90  # 생두 투입으로 220→215°C
        else:
            et = 215 + math.sin(t / 300) * 0.8  # 215°C 기준 ±0.8°C 리플

        times.append(float(t))
        temp1.append(round(et, 1))
        temp2.append(round(bt, 1))

    return {"mode": "C", "timex": times, "temp1": temp1, "temp2": temp2}


_DEFAULT_PROFILE = _build_default_profile()


# ── 가상 머신 엔진 ─────────────────────────────────────────


class VirtualMachine:
    """프로파일 기반 온도 시뮬레이션 엔진.

    주어진 (timex, temp1, temp2) 프로파일을 선형 보간하여
    임의 시점의 ET(Environment Temperature)와 BT(Bean Temperature)를 반환한다.
    """

    __slots__ = ("_timex", "_temp1", "_temp2")

    def __init__(self, profile: dict[str, Any]) -> None:
        self._timex: list[float] = profile["timex"]
        self._temp1: list[float] = profile["temp1"]
        self._temp2: list[float] = profile["temp2"]

    def read(self, tx: float) -> tuple[float, float]:
        """경과 시간 ``tx``(초)에 대한 ``(ET, BT)`` 를 반환한다."""
        try:
            if tx <= 0:
                return self._temp1[0], self._temp2[0]
            et = _interp(tx, self._timex, self._temp1)
            bt = _interp(tx, self._timex, self._temp2)
            return et, bt
        except Exception:
            return -1.0, -1.0


# ── 어댑터 ─────────────────────────────────────────────────


class VirtualMachineAdapter:
    """개발/테스트용 가상 머신 어댑터.

    ``BaseAdapter`` 프로토콜을 구현하며, 내부적으로 ``VirtualMachine``
    엔진을 사용해 실제 머신 없이 온도 데이터를 시뮬레이션한다.
    """

    def __init__(self, mode: str = "C", **_: Any) -> None:
        self._vm = VirtualMachine(_DEFAULT_PROFILE)
        self._start_time: float = 0.0
        self._connected: bool = False

    async def connect(self) -> None:
        self._start_time = time.monotonic()
        self._connected = True
        _log.info("VirtualMachine connected")

    async def disconnect(self) -> None:
        self._connected = False

    async def read(self) -> Reading:
        tx = time.monotonic() - self._start_time
        et, bt = self._vm.read(tx)

        # 가상 제어값 — 780초 프로파일 기준 선형 변화
        heater = 70.0 - (tx / 780.0) * 20.0  # 70% → 50%
        fan = 30.0 + (tx / 780.0) * 30.0  # 30% → 60%
        drum = 50.0  # 고정

        return Reading(
            bt=bt,
            et=et,
            heater=round(heater, 1),
            fan=round(fan, 1),
            drum=drum,
            timestamp=time.monotonic(),
        )

    async def start_roast(self) -> None:
        """Charge 시점부터 프로파일 재생을 시작한다."""
        self._start_time = time.monotonic()

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        pass

    @property
    def connected(self) -> bool:
        return self._connected

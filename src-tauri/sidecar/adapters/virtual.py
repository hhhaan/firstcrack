"""
가상 로스팅 머신 시뮬레이터 — 개발/테스트용.

세 단계로 동작한다:
  1. 예열 (connect ~ enter_standby): BT가 서서히 목표 예열 온도까지 상승
  2. 대기 (enter_standby ~ start_roast): BT가 예열 목표에서 안정적으로 유지
  3. 로스팅 (start_roast 이후): Charge 시점 BT에서 즉각 25°C 강하 → 로스팅 커브 재생
"""

import math
import random
import time
import logging
from bisect import bisect_right
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)


# ── 선형 보간 ──────────────────────────────────────────────


def _interp(x: float, xp: list[float], fp: list[float]) -> float:
    if x <= xp[0]:
        return fp[0]
    if x >= xp[-1]:
        return fp[-1]
    i = bisect_right(xp, x)
    x0, x1 = xp[i - 1], xp[i]
    y0, y1 = fp[i - 1], fp[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


# ── 예열 시뮬레이션 파라미터 ───────────────────────────────

_PREHEAT_COLD_BT = 25.0    # 최초 연결 시 BT (실온)
_PREHEAT_COLD_ET = 25.0    # 최초 연결 시 ET (실온)
_PREHEAT_TARGET_BT = 200.0 # 목표 예열 BT
_PREHEAT_TARGET_ET = 230.0 # 목표 예열 ET
_PREHEAT_DURATION = 60.0   # 예열 완료까지 걸리는 시간(초) — 데모용 1분

# Charge 시 즉각 강하량 — 실제 생두 투입 시 20~30°C 강하
_CHARGE_DROP = 25.0


# ── 로스팅 프로파일 ────────────────────────────────────────
#
# t=0 = Charge (생두 투입) 시점. 기준 온도 200°C.
# 처음 15초에 25°C 즉각 강하 → 90초에 TP → 이후 로스팅 상승.

def _build_roast_profile() -> dict[str, Any]:
    """0~780초(13분) 로스팅 프로파일."""
    times: list[float] = []
    bts: list[float] = []
    ets: list[float] = []

    for t in range(0, 781, 5):
        # BT: Charge 직후 15초 안에 25°C 급강하 → 이후 90초까지 완만하게 TP로 하강 → 상승
        if t <= 15:
            bt = 200.0 - (25.0 * t) / 15.0          # 200 → 175°C (급강하, Charge 충격)
        elif t <= 90:
            bt = 175.0 - (23.0 * (t - 15)) / 75.0   # 175 → 152°C (완만 하강, TP로)
        elif t <= 180:
            bt = 152.0 + (4.0 * (t - 90)) / 90.0    # 152 → 156°C (건조)
        elif t <= 420:
            bt = 156.0 + (19.0 * (t - 180)) / 240.0 # 156 → 175°C (Maillard)
        elif t <= 600:
            bt = 175.0 + (19.0 * (t - 420)) / 180.0 # 175 → 194°C (1C ~ Development)
        else:
            bt = 194.0 + (10.0 * (t - 600)) / 180.0 # 194 → 204°C (마무리)

        # ET: 투입 직후 소폭 강하, 이후 안정
        if t <= 60:
            et = 230.0 - (8.0 * t) / 60.0
        elif t <= 120:
            et = 222.0 + (3.0 * (t - 60)) / 60.0
        else:
            et = 225.0 + math.sin(t / 120.0) * 0.6

        times.append(float(t))
        bts.append(round(bt, 2))
        ets.append(round(et, 2))

    return {"timex": times, "bt": bts, "et": ets}


_ROAST_PROFILE = _build_roast_profile()


# ── 노이즈 ────────────────────────────────────────────────


def _noise(scale: float = 0.3) -> float:
    """±scale °C 범위의 부드러운 노이즈."""
    return (random.random() * 2 - 1) * scale


# ── 어댑터 ─────────────────────────────────────────────────


class VirtualMachineAdapter:
    """개발/테스트용 가상 머신 어댑터.

    connect() → 예열 상승
    enter_standby() → 예열 목표 온도에서 안정 유지 (강하 없음)
    start_roast() → Charge 시점 BT 기록 후 로스팅 커브 재생
    """

    def __init__(self, mode: str = "C", **_: Any) -> None:
        self._connected: bool = False
        self._roasting: bool = False
        self._connect_time: float = 0.0
        self._roast_start_time: float = 0.0
        self._charge_bt: float = _PREHEAT_TARGET_BT  # Charge 시점 BT

    async def connect(self) -> None:
        self._connect_time = time.monotonic()
        self._roasting = False
        self._charge_bt = _PREHEAT_TARGET_BT
        self._connected = True
        _log.info("VirtualMachine connected — preheating")

    async def disconnect(self) -> None:
        self._connected = False
        self._roasting = False

    async def read(self) -> Reading:
        if not self._connected:
            return Reading(bt=-1.0, et=-1.0, heater=0, fan=0, drum=0, timestamp=time.monotonic())

        if not self._roasting:
            return self._read_preheat()
        else:
            return self._read_roasting()

    def _read_preheat(self) -> Reading:
        """예열 + 대기 단계: BT가 목표 온도까지 서서히 상승 후 안정 유지."""
        elapsed = time.monotonic() - self._connect_time
        ratio = min(elapsed / _PREHEAT_DURATION, 1.0)
        # easeOut 곡선으로 처음엔 빠르게, 나중엔 천천히 상승
        ease = 1.0 - (1.0 - ratio) ** 2

        target_bt = _PREHEAT_COLD_BT + (_PREHEAT_TARGET_BT - _PREHEAT_COLD_BT) * ease
        target_et = _PREHEAT_COLD_ET + (_PREHEAT_TARGET_ET - _PREHEAT_COLD_ET) * ease

        bt = target_bt + _noise(0.4)
        et = target_et + _noise(0.3)

        # 예열 완료에 가까울수록 heater 출력 낮아짐 (온도 유지 모드)
        heater = 90.0 - ease * 30.0  # 90% → 60%
        fan = 20.0
        drum = 50.0

        return Reading(
            bt=round(bt, 1),
            et=round(et, 1),
            heater=round(heater, 1),
            fan=fan,
            drum=drum,
            timestamp=time.monotonic(),
        )

    async def enter_standby(self) -> None:
        """READY 버튼 → Standby 진입. 예열 온도 유지, 강하 시뮬레이션 없음."""
        _log.info("VirtualMachine: standby entered — holding preheat temperature")

    def _read_roasting(self) -> Reading:
        """로스팅 단계: Charge BT 기준 오프셋 적용 후 프로파일 보간."""
        tx = time.monotonic() - self._roast_start_time

        bt_profile = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["bt"])
        et_profile = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["et"])

        # Charge 시점 실제 BT가 기준(200°C)과 다를 경우 오프셋 적용
        bt_offset = self._charge_bt - _PREHEAT_TARGET_BT
        bt = bt_profile + bt_offset + _noise(0.4)
        et = et_profile + bt_offset * 0.3 + _noise(0.25)

        heater = max(40.0, 75.0 - (tx / 780.0) * 25.0)
        fan = min(70.0, 30.0 + (tx / 780.0) * 40.0)
        drum = 50.0

        return Reading(
            bt=round(bt, 1),
            et=round(et, 1),
            heater=round(heater, 1),
            fan=round(fan, 1),
            drum=drum,
            timestamp=time.monotonic(),
        )

    async def start_roast(self) -> None:
        """Charge 시점. 현재 BT를 기록하고 로스팅 커브 재생 시작."""
        # Charge 직전 예열 온도를 캡처해 로스팅 프로파일 오프셋에 사용
        preheat = self._read_preheat()
        self._charge_bt = preheat.bt
        self._roast_start_time = time.monotonic()
        self._roasting = True
        _log.info("VirtualMachine: charge at BT=%.1f°C — roasting started", self._charge_bt)

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

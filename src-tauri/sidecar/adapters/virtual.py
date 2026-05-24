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

_PREHEAT_TARGET_BT = 210.0 # 예열 목표 BT (connect 즉시 도달)
_PREHEAT_TARGET_ET = 230.0 # 예열 목표 ET (connect 즉시 도달)

# Charge 시 즉각 강하량 — 실제 생두 투입 시 20~30°C 강하
_CHARGE_DROP = 25.0


# ── 로스팅 프로파일 ────────────────────────────────────────
#
# t=0 = Charge (생두 투입) 시점. 기준 온도 200°C.
# 처음 15초에 25°C 즉각 강하 → 90초에 TP → 이후 로스팅 상승.

def _build_roast_profile() -> dict[str, Any]:
    """0~780초(13분) 로스팅 프로파일. 기준 BT 200°C (실제 charge BT와의 차이는 오프셋 적용)."""
    times: list[float] = []
    bts: list[float] = []
    ets: list[float] = []

    for t in range(0, 781, 5):
        # BT: 실제 로스팅 머신과 유사한 곡선
        #   0~20s  : charge 충격으로 급강하 (22°C/20s)
        #   20~120s: 완만하게 TP(145°C)로 하강
        #   120~180s: TP 이후 완만 회복 (건조 시작)
        #   180~360s: Maillard — 온도 상승 가속
        #   360~540s: 1C 접근
        #   540~660s: 1C ~ Development
        #   660~780s: Drop 직전 마무리
        if t <= 20:
            bt = 200.0 - (22.0 * t) / 20.0
        elif t <= 120:
            bt = 178.0 - (33.0 * (t - 20)) / 100.0
        elif t <= 180:
            bt = 145.0 + (7.0 * (t - 120)) / 60.0
        elif t <= 360:
            bt = 152.0 + (22.0 * (t - 180)) / 180.0
        elif t <= 540:
            bt = 174.0 + (19.0 * (t - 360)) / 180.0
        elif t <= 660:
            bt = 193.0 + (7.0 * (t - 540)) / 120.0
        else:
            bt = 200.0 + (8.0 * (t - 660)) / 120.0

        # ET: 드럼 환경 온도 — 항상 BT보다 높고 완만하게 상승
        #   0~30s  : 생두 투입 충격으로 소폭 강하
        #   30~90s : 회복
        #   90~420s: 완만한 상승 (Maillard 진행)
        #   420~780s: 지속 상승
        if t <= 30:
            et = 230.0 - (12.0 * t) / 30.0
        elif t <= 90:
            et = 218.0 + (6.0 * (t - 30)) / 60.0
        elif t <= 420:
            et = 224.0 + (10.0 * (t - 90)) / 330.0
        else:
            et = 234.0 + (8.0 * (t - 420)) / 360.0

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
        self._standby_time: float = 0.0  # enter_standby() 호출 시각

    async def connect(self) -> None:
        self._connect_time = time.monotonic()
        self._roasting = False
        self._standby_time = 0.0
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
        """예열 + 대기 단계: standby 진입 10초 후 BT를 5°C/s로 최대 25°C 강하 → auto-charge 유발."""
        bt_base = _PREHEAT_TARGET_BT
        if self._standby_time > 0:
            elapsed = time.monotonic() - self._standby_time - 10.0
            if elapsed > 0:
                bt_base -= min(elapsed * 5.0, 25.0)

        bt = bt_base + _noise(0.4)
        et = _PREHEAT_TARGET_ET + _noise(0.3)

        heater = 60.0
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
        """READY 버튼 → 10초 후 BT 강하 시작, auto-charge 감지 유발."""
        self._standby_time = time.monotonic()
        _log.info("VirtualMachine: standby entered — bean drop in 10s")

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

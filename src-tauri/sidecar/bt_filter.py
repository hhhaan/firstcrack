"""BT 이상치 필터 — 프론트 `createBtFilter`와 동일 계약.

범위 밖(≤0, ≥400)은 즉시 거부. 변화율 초과 샘플은 1회 보류하고, 다음 샘플이
보류값과 연속이면 실제 스텝으로 승인한다. 단일 스파이크는 궤적 복귀로 폐기.
"""

from __future__ import annotations

import math
from typing import Callable

BT_MIN_C = 0.0
BT_MAX_C = 400.0
MAX_RATE_C_PER_S = 15.0
MIN_DT_S = 0.25
MAX_DT_S = 10.0


def _clamp_dt(from_ms: float, to_ms: float) -> float:
    return min(max((to_ms - from_ms) / 1000.0, MIN_DT_S), MAX_DT_S)


def create_bt_filter() -> Callable[[float, float], float | None]:
    last: dict[str, float] | None = None
    rejected: dict[str, float] | None = None

    def filter_bt(bt: float, t_ms: float) -> float | None:
        nonlocal last, rejected
        if not math.isfinite(bt) or bt <= BT_MIN_C or bt >= BT_MAX_C:
            return None
        if last is None:
            last = {"bt": bt, "t_ms": t_ms}
            return bt
        if abs(bt - last["bt"]) <= MAX_RATE_C_PER_S * _clamp_dt(last["t_ms"], t_ms):
            last = {"bt": bt, "t_ms": t_ms}
            rejected = None
            return bt
        if rejected is not None and abs(bt - rejected["bt"]) <= MAX_RATE_C_PER_S * _clamp_dt(
            rejected["t_ms"], t_ms
        ):
            last = {"bt": bt, "t_ms": t_ms}
            rejected = None
            return bt
        rejected = {"bt": bt, "t_ms": t_ms}
        return None

    return filter_bt

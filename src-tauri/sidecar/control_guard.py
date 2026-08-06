"""제어 명령 검증 — /control의 신뢰 경계.

어댑터는 관대하게(모르는 role 무시, 미연결 시 no-op) 동작하고, 엄격한 검사는
여기서 한 번에 한다. 순수 함수만 두어 I/O 없이 테스트할 수 있게 유지한다.

거부(400)와 클램프(200)의 기준:
  - **거부**: 숫자가 아니거나 NaN/Inf, 또는 이 머신이 쓸 수 없는 role.
    무엇을 쓰라는 건지 알 수 없는 요청이다.
  - **클램프**: 범위를 벗어난 수치. 머신 한계로 잘라서 적용하고 응답의
    `applied`로 실제 값을 돌려준다. 거부하면 "최대 화력" 의도가 아무것도
    적용되지 않은 채 실패하는데, 안전상 이득 없이 실패 모드만 늘어난다.
"""

import math
from typing import Any

# control()이 받는 role. write_map에 있어야 실제로 쓰인다.
WRITABLE_ROLES = ("heater", "fan", "drum")


class ControlRangeError(ValueError):
    """요청이 형식상 잘못됨 (비수치, NaN/Inf, 미지원 role) — HTTP 400."""


class ControlUnavailable(RuntimeError):
    """지금 쓸 수 없음 (미연결, 쓰기 맵 없음) — HTTP 409."""


def parse_command(body: dict[str, Any]) -> dict[str, float]:
    """요청 바디에서 쓸 role만 뽑아 float으로 정규화한다 (형식 검증만).

    role 지원 여부는 머신 상태를 알아야 하므로 manager가 판단한다.
    빈 요청은 빈 dict를 반환한다 (no-op 허용).
    """
    cmd: dict[str, float] = {}
    for role in WRITABLE_ROLES:
        raw = body.get(role)
        if raw is None:
            continue
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ControlRangeError(f"{role} 값이 숫자가 아닙니다: {raw!r}")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ControlRangeError(f"{role} 값이 숫자가 아닙니다: {raw!r}") from None
        if not math.isfinite(value):
            raise ControlRangeError(f"{role} 값이 유효하지 않습니다: {raw!r}")
        cmd[role] = value
    return cmd


def clamp_command(
    cmd: dict[str, float], write_map: dict[str, dict[str, Any]]
) -> dict[str, float]:
    """write_map의 min/max로 자른다. 어댑터도 한 번 더 자르는 심층 방어."""
    clamped: dict[str, float] = {}
    for role, value in cmd.items():
        spec = write_map.get(role, {})
        lo = spec.get("min")
        hi = spec.get("max")
        if lo is not None:
            value = max(float(lo), value)
        if hi is not None:
            value = min(float(hi), value)
        clamped[role] = value
    return clamped

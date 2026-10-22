"""소프트웨어 PID — 순수 계산.

I/O도 시계도 갖지 않는다. 호출자가 PV와 시각을 넘기고 duty를 돌려받는다.
루프 수명·안전 상태·쓰기 정책은 pid_runner가 담당한다.

설계 선택과 이유:

- **미분은 측정값 기준(derivative-on-measurement)**: 오차 미분을 쓰면 SV를 바꾸는
  순간 D항이 튀어(derivative kick) 버너가 한 번 걷어차인다. 로스팅 중 SV 조정은
  일상적인 조작이므로 이 킥은 실제로 발생한다.
- **조건부 적분**: 출력이 이미 상한에 붙어 있는데 같은 방향 오차로 계속 적분하면
  적분항이 부풀어(windup) SV에 도달한 뒤에도 한참 과열된다. 포화 방향으로는
  적분을 멈춘다.
- **back-calculation**: 클램프로 잘려나간 만큼 적분항을 되돌려, 포화에서 빠져나올 때
  응답이 굼뜨지 않게 한다.
- **측정 불연속 감쇠**: 열전대는 순간적으로 튄다. 튄 값을 그대로 미분하면 D항이
  화력을 크게 흔든다. 최근 변화량 대비 비정상적으로 큰 점프는 미분 기여를 줄인다.

게인 스케줄링은 넣지 않았다 — 레지스트리가 머신당 게인 한 벌만 갖고 있다.
"""

from collections import deque
from dataclasses import dataclass
import math
from typing import Any


@dataclass(frozen=True)
class PidGains:
    kp: float
    ki: float
    kd: float


class SoftwarePid:
    """단일 루프 PID.

    OFF 상태에서도 호출자가 계속 update()를 불러도 되게 설계했다. 비활성일 때는
    타깃이 PV를 따라가므로(bumpless) 다시 켜는 순간 오차가 0에서 시작한다.
    """

    def __init__(
        self,
        gains: PidGains,
        *,
        out_min: float = 0.0,
        out_max: float = 100.0,
        sp_weight_p: float = 1.0,
        # 0.0 = 순수 derivative-on-measurement(기본). 1.0으로 올리면 SV도 미분에
        # 들어가 오차 미분이 되고, SV를 바꾸는 순간 D항이 튄다 — 이 모듈이 피하려는
        # 동작이라 기본값은 0이다. 실기 튜닝용으로만 열어 둔다.
        sp_weight_d: float = 0.0,
        integral_band_factor: float = 1.0,
        d_clamp: float = 100.0,
        sv_jump_threshold: float = 25.0,
        min_dt: float = 0.05,
    ) -> None:
        self.gains = gains
        self.out_min = out_min
        self.out_max = out_max
        self.sp_weight_p = sp_weight_p
        self.sp_weight_d = sp_weight_d
        self.integral_band_factor = integral_band_factor
        self.d_clamp = d_clamp
        self.sv_jump_threshold = sv_jump_threshold
        self.min_dt = min_dt

        self._sv: float = 0.0
        # 최초 SV 지정과 "운전 중 SV 변경"을 구분한다. 구분하지 않으면 처음
        # set_target(200)이 0 → 200 점프로 잡혀 첫 적분 사이클이 버려진다.
        self._sv_initialized = False
        self._active = False
        self._i_term = 0.0
        self._p_term = 0.0
        self._d_term = 0.0
        self._last_ts: float | None = None
        self._last_pv: float | None = None
        self._prev_d_input: float | None = None
        self._prev_raw_output = 0.0
        self._prev_output_bounds = (out_min, out_max)
        self._skip_integration_once = False
        self._attenuate_d_once = False
        self._seed_output: float | None = None
        # 최근 PV 변화량 — 불연속(스파이크) 판정용
        self._pv_deltas: deque[float] = deque(maxlen=5)

    # ── 상태 조회 ──────────────────────────────────────────────────────────

    @property
    def active(self) -> bool:
        return self._active

    @property
    def target(self) -> float:
        return self._sv

    @property
    def requested_output(self) -> float:
        return self._prev_raw_output

    def snapshot(self) -> dict[str, Any]:
        return {
            "active": self._active,
            "sv": round(self._sv, 1),
            "p": round(self._p_term, 2),
            "i": round(self._i_term, 2),
            "d": round(self._d_term, 2),
        }

    # ── 수명 주기 ──────────────────────────────────────────────────────────

    def set_target(self, sv: float, *, bumpless: bool = False) -> None:
        """SV 변경. 큰 점프는 적분 이력을 버린다.

        옛 SV를 향해 쌓인 적분항은 새 SV에서는 근거 없는 편향이다. 그대로 두면
        SV를 크게 올린 직후 한참 과하게 때린다.
        """
        delta = abs(sv - self._sv)
        first_assignment = not self._sv_initialized
        self._sv = sv
        self._sv_initialized = True
        if bumpless or first_assignment:
            return
        if delta > self.sv_jump_threshold:
            self._i_term = 0.0
            self._skip_integration_once = True
            self._attenuate_d_once = True
        elif delta > self.sv_jump_threshold / 2:
            self._i_term *= 0.5
            self._attenuate_d_once = True

    def engage(self, now: float, seed_output: float | None = None) -> None:
        """제어 시작. seed_output(현재 머신 duty)을 주면 첫 출력이 그 값에서 이어진다.

        시드가 없으면 적분항 0에서 시작해 첫 tick에 출력이 뚝 떨어진다 — 이미
        불이 붙어 있는 로스터에서는 화력 공백이 된다.
        """
        self._active = True
        self._last_ts = now
        self._seed_output = seed_output

    def release(self) -> None:
        """제어 중단. 내부 상태는 유지해 재개가 부드럽다."""
        self._active = False
        self._seed_output = None

    def resume(self, now: float) -> None:
        """HOLD 등으로 건너뛴 시간 뒤 재개할 때 시간 기준을 다시 잡는다.

        이걸 안 하면 5초 공백 뒤 첫 tick의 dt가 5초가 되어 적분항이 한 번에
        크게 뛴다.
        """
        self._last_ts = now
        self._prev_d_input = None

    def reset(self) -> None:
        self._i_term = 0.0
        self._p_term = 0.0
        self._d_term = 0.0
        self._last_ts = None
        self._last_pv = None
        self._prev_d_input = None
        self._prev_raw_output = 0.0
        self._prev_output_bounds = (self.out_min, self.out_max)
        self._skip_integration_once = False
        self._attenuate_d_once = False
        self._seed_output = None
        self._pv_deltas.clear()

    # ── 계산 ───────────────────────────────────────────────────────────────

    def update(self, pv: float, now: float, *,
               output_bounds: tuple[float, float] | None = None) -> float | None:
        """한 사이클. 출력(clamp된 duty)을 반환하고, 건너뛴 사이클은 None."""
        lower, upper = self.out_min, self.out_max
        if output_bounds is not None:
            if (len(output_bounds) != 2 or any(isinstance(value, bool)
                    or not isinstance(value, (int, float)) or not math.isfinite(value)
                    for value in output_bounds)):
                raise ValueError("Output bounds must be two finite numbers")
            lower, upper = max(lower, output_bounds[0]), min(upper, output_bounds[1])
            if lower > upper:
                raise ValueError("Output bounds do not intersect the absolute output range")
        if self._last_ts is None:
            self._last_ts = now
            self._last_pv = pv
            return None

        dt = now - self._last_ts
        if dt < self.min_dt:
            return None

        self._track_pv_delta(pv)

        if not self._active:
            # 비활성 중에는 타깃이 PV를 따라간다 → 재개 시 오차 0에서 출발
            self._sv = pv
            self._last_ts = now
            self._last_pv = pv
            self._prev_d_input = self.sp_weight_d * self._sv - pv
            return None

        err = self._sv - pv
        self._p_term = self.gains.kp * (self.sp_weight_p * self._sv - pv)
        self._d_term = self._derivative(pv, dt)

        if self._seed_output is not None:
            # 첫 사이클: 현재 duty가 그대로 나오도록 적분항을 역산한다.
            # 역산값도 밴드로 자른다 — P가 크면(예: kp=20, 오차 -30 → P=-600)
            # 시드 적분항이 밴드의 몇 배가 되어 여러 사이클 동안 포화가 풀리지 않는다.
            self._i_term = self._seed_output - self._p_term - self._d_term
            self._clamp_integral()
            self._seed_output = None
        else:
            self._integrate(err, dt, self._prev_output_bounds if output_bounds is not None
                            else (self.out_min, self.out_max))

        raw = self._p_term + self._i_term + self._d_term
        out = min(upper, max(lower, raw))
        self._back_calculate(raw, out)

        self._prev_raw_output = raw
        self._prev_output_bounds = (lower, upper)
        self._last_ts = now
        self._last_pv = pv
        return out

    # ── 내부 ───────────────────────────────────────────────────────────────

    def _track_pv_delta(self, pv: float) -> None:
        if self._last_pv is not None:
            self._pv_deltas.append(abs(pv - self._last_pv))

    def _is_discontinuous(self, pv: float) -> bool:
        """센서 스파이크 판정 — 상대(최근 평균의 2.5배)와 절대(1.0°C) 조건 모두 충족."""
        if self._last_pv is None or len(self._pv_deltas) < 2:
            return False
        change = abs(pv - self._last_pv)
        # 마지막 항목은 이번 변화량 자신이므로 제외하고 평균을 낸다
        history = list(self._pv_deltas)[:-1]
        avg = sum(history) / len(history)
        return change > 1.0 and change > 2.5 * avg

    def _derivative(self, pv: float, dt: float) -> float:
        d_input = self.sp_weight_d * self._sv - pv
        if self._prev_d_input is None:
            self._prev_d_input = d_input
            return 0.0
        d_raw = (d_input - self._prev_d_input) / dt
        self._prev_d_input = d_input

        d_raw = min(self.d_clamp, max(-self.d_clamp, d_raw))
        if self._attenuate_d_once:
            d_raw *= 0.5
            self._attenuate_d_once = False
        if self._is_discontinuous(pv):
            d_raw *= 0.3
        return self.gains.kd * d_raw

    def _clamp_integral(self) -> None:
        """적분항을 출력 범위 기반 밴드로 자른다. 적분항이 커지는 모든 경로가 거쳐야 한다.

        ponytail: 가열 전용 루프(out_min=0)에서는 하한을 0으로 막는 스톱갭이다.
        출력이 음수가 될 수 없으므로 음의 적분항은 "가열 지연"으로만 작용하는데,
        실제 Giesen 게인(Kp20/Ki0.01)에서는 상승 과도 첫 tick에 i가 -100까지 밀린 뒤
        Ki가 미세해 수십 분간 상환되지 않는다(= 정상상태 SV 언더슛 약 5°C).
        근본 수정(back-calculation의 Kt·dt 스케일, 조건부 적분 정리)은 이슈 #196에서 추적한다.
        냉각까지 하는 루프(out_min < 0)를 만들면 기존대로 대칭 밴드를 쓴다.
        """
        band = self.integral_band_factor * (self.out_max - self.out_min)
        lower = 0.0 if self.out_min >= 0.0 else -band
        self._i_term = min(band, max(lower, self._i_term))

    def _integrate(self, err: float, dt: float, output_bounds: tuple[float, float]) -> None:
        if self._skip_integration_once:
            self._skip_integration_once = False
            return
        # 이미 포화된 방향으로 더 밀어붙이는 적분은 windup만 만든다
        saturated_high = self._prev_raw_output > output_bounds[1] and err > 0
        saturated_low = self._prev_raw_output < output_bounds[0] and err < 0
        if saturated_high or saturated_low:
            return
        self._i_term += self.gains.ki * err * dt
        self._clamp_integral()

    def _back_calculate(self, raw: float, out: float) -> None:
        """클램프로 잘린 만큼 적분항을 되돌린다 (계수 0.5 = 절반만 보정)."""
        excess = raw - out
        if abs(excess) <= 1e-9:
            return
        self._i_term -= excess * 0.5
        self._clamp_integral()

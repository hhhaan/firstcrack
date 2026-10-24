"""SoftwarePid 순수 계산 테스트 — 시계 없이 now를 직접 넘긴다."""

import math
import random

import pytest

from adapters.thermal_model import FirstOrderThermalModel
from pid import PidGains, SoftwarePid
from roast_target import RawObservation, advance_filter


def make_pid(kp=2.0, ki=0.0, kd=0.0, **kw) -> SoftwarePid:
    return SoftwarePid(PidGains(kp, ki, kd), **kw)


class TestSampling:
    def test_first_update_only_initializes(self):
        pid = make_pid()
        pid.set_target(200.0)
        pid.engage(now=0.0)
        assert pid.update(pv=180.0, now=0.0) is None

    def test_skips_sample_below_min_dt(self):
        pid = make_pid()
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(180.0, 0.0)
        assert pid.update(180.0, 0.01) is None  # dt=0.01 < min_dt=0.05

    def test_inactive_target_tracks_pv(self):
        """OFF 상태에서 계속 돌려도 재개 시 오차가 0에서 시작해야 한다."""
        pid = make_pid()
        pid.set_target(200.0)
        pid.update(150.0, 0.0)
        assert pid.update(150.0, 1.0) is None
        assert pid.target == 150.0


class TestProportional:
    def test_proportional_only_response(self):
        pid = make_pid(kp=2.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(180.0, 0.0)
        out = pid.update(180.0, 1.0)
        assert out == pytest.approx(40.0)  # 2.0 × (200 - 180)

    def test_output_clamped_to_limits(self):
        pid = make_pid(kp=50.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(180.0, 0.0)
        assert pid.update(180.0, 1.0) == 100.0

    def test_negative_error_clamped_at_min(self):
        pid = make_pid(kp=2.0)
        pid.set_target(180.0)
        pid.engage(now=0.0)
        pid.update(220.0, 0.0)
        assert pid.update(220.0, 1.0) == 0.0


class TestIntegral:
    def test_integral_accumulates_over_time(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        first = pid.update(190.0, 1.0)   # i += 1.0 × 10 × 1s = 10
        second = pid.update(190.0, 2.0)  # i += 10 → 20
        assert first == pytest.approx(10.0)
        assert second == pytest.approx(20.0)

    def test_integral_clamped_to_band(self):
        pid = make_pid(kp=0.0, ki=100.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(100.0, 0.0)
        for t in range(1, 8):
            pid.update(100.0, float(t))
        # 밴드 = integral_band_factor(1.0) × (out_max - out_min) = 100
        assert pid.snapshot()["i"] <= 100.0

    def test_conditional_integration_when_saturated(self):
        """출력이 상한에 붙어 있는 동안 같은 방향 적분은 멈춰야 한다 (windup 방지)."""
        pid = make_pid(kp=10.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(100.0, 0.0)
        pid.update(100.0, 1.0)  # raw = 1000+ → 포화
        i_after_saturation = pid.snapshot()["i"]
        pid.update(100.0, 2.0)
        pid.update(100.0, 3.0)
        # 포화 중 적분이 계속 늘지 않았다
        assert pid.snapshot()["i"] <= i_after_saturation

    def test_back_calculation_reduces_integral_on_overshoot(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(100.0, 0.0)
        pid.update(100.0, 1.0)  # i = 100 (밴드 상한), raw=100 → 클램프 없음
        before = pid.snapshot()["i"]
        # 오차를 유지해 raw가 out_max를 넘게 만든 뒤 되돌림 확인
        pid._i_term = 150.0  # noqa: SLF001 — 포화 상태를 직접 만든다
        pid.update(100.0, 2.0)
        assert pid.snapshot()["i"] < 150.0
        assert before <= 100.0


class TestIntegralDebt:
    """실기 게인(Giesen)에서 적분항이 음의 밴드에 고착하지 않는지 — 이슈 #196.

    가상 머신 게인(Kp4/Ki0.3/Kd2)으로는 재현되지 않는다. Kp가 크고 Ki가 미세한
    조합에서만 시드 역산·back-calculation이 i를 -100까지 밀어넣고, Ki=0.01로는
    분당 ~5씩밖에 상환하지 못해 수십 분간 화력이 부족해진다.
    """

    # roaster_registry.py의 Giesen 엔트리 8개가 공유하는 값
    GIESEN = dict(kp=20.0, ki=0.01, kd=3.0)

    def test_giesen_engage_never_parks_integral_below_zero(self):
        """BT150 → SV200 engage(seed 50%). 하한이 -100이면 tick 1에서 바로 고착했다."""
        pid = make_pid(**self.GIESEN)
        pid.set_target(200.0)
        pid.engage(now=0.0, seed_output=50.0)
        pid.update(150.0, 0.0)

        pv = 150.0
        for t in range(1, 61):
            pv = min(199.0, pv + 0.8)  # 완만한 상승 — 오차가 계속 양수로 남는다
            pid.update(pv, float(t))
            assert pid.snapshot()["i"] >= 0.0, f"t={t}에서 적분 부채 발생"

    def test_giesen_engage_keeps_full_duty_while_far_below_sv(self):
        """오차 50°C면 P만으로 1000 — 적분 부채와 무관하게 duty는 100이어야 한다."""
        pid = make_pid(**self.GIESEN)
        pid.set_target(200.0)
        pid.engage(now=0.0, seed_output=50.0)
        pid.update(150.0, 0.0)
        assert pid.update(150.0, 1.0) == 100.0


class TestSetpointChange:
    def test_large_sv_step_resets_integral(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        assert pid.snapshot()["i"] > 0
        pid.set_target(240.0)  # Δ40 > 25
        assert pid.snapshot()["i"] == 0.0

    def test_large_sv_step_skips_one_integration_cycle(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        pid.set_target(240.0)
        pid.update(190.0, 2.0)
        assert pid.snapshot()["i"] == 0.0  # 이 사이클은 적분 생략
        pid.update(190.0, 3.0)
        assert pid.snapshot()["i"] > 0.0   # 다음 사이클부터 재개

    def test_half_threshold_sv_step_halves_integral(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        before = pid.snapshot()["i"]
        pid.set_target(215.0)  # Δ15 → threshold(25)의 절반 초과
        assert pid.snapshot()["i"] == pytest.approx(before / 2)

    def test_bumpless_target_change_keeps_integral(self):
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        before = pid.snapshot()["i"]
        pid.set_target(250.0, bumpless=True)
        assert pid.snapshot()["i"] == before


class TestDerivative:
    def test_no_derivative_kick_on_sv_step(self):
        """미분이 측정값 기준이면 SV만 바뀐 사이클에 D항이 튀지 않는다."""
        pid = SoftwarePid(PidGains(0.0, 0.0, 10.0))
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        pid.set_target(260.0, bumpless=True)
        out = pid.update(190.0, 2.0)  # PV 그대로, SV만 점프
        assert out == pytest.approx(0.0)

    def test_derivative_responds_to_pv_change(self):
        pid = SoftwarePid(PidGains(0.0, 0.0, 2.0))
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        out = pid.update(195.0, 2.0)  # PV 상승 → 음의 D (제동)
        assert pid.snapshot()["d"] < 0
        assert out == 0.0  # 음의 출력은 out_min(0)으로 클램프된다

    def test_derivative_clamped(self):
        pid = SoftwarePid(PidGains(0.0, 0.0, 1.0), d_clamp=5.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        pid.update(1000.0, 2.0)  # 거대한 점프
        assert abs(pid.snapshot()["d"]) <= 5.0

    def test_measurement_spike_is_attenuated(self):
        """센서 스파이크는 미분 기여를 줄여 화력이 크게 흔들리지 않게 한다."""
        steady = SoftwarePid(PidGains(0.0, 0.0, 1.0), d_clamp=1e9)
        steady.set_target(200.0)
        steady.engage(now=0.0)
        # 완만한 변화 이력을 쌓는다 (0.1°C/s)
        pv = 190.0
        steady.update(pv, 0.0)
        for t in range(1, 5):
            pv += 0.1
            steady.update(pv, float(t))
        steady.update(pv + 10.0, 5.0)
        # 감쇠(×0.3)가 걸렸으므로 kd×10 = -10 이 아니라 -3 수준
        assert steady.snapshot()["d"] == pytest.approx(-3.0, rel=0.05)


class TestEngageRelease:
    def test_engage_with_seed_is_bumpless(self):
        """이미 60% duty로 돌던 머신에서 켜면 첫 출력이 60% 근처여야 한다."""
        pid = make_pid(kp=2.0)
        pid.set_target(200.0)
        pid.engage(now=0.0, seed_output=60.0)
        pid.update(195.0, 0.0)
        out = pid.update(195.0, 1.0)
        assert out == pytest.approx(60.0)

    def test_seed_is_clamped_to_integral_band(self):
        """P가 크면 역산 적분항이 밴드의 몇 배가 된다 — 포화가 몇 사이클 안 풀린다."""
        pid = make_pid(kp=20.0)
        pid.set_target(200.0)
        pid.engage(now=0.0, seed_output=100.0)
        pid.update(230.0, 0.0)   # 오차 -30 → P = -600
        pid.update(230.0, 1.0)
        # 밴드 = 1.0 * (100 - 0) = 100. 양의 상한으로 잘려야 한다 (0으로 죽지 않고)
        assert pid.snapshot()["i"] == pytest.approx(100.0)

    def test_engage_without_seed_starts_from_terms_only(self):
        pid = make_pid(kp=2.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(195.0, 0.0)
        assert pid.update(195.0, 1.0) == pytest.approx(10.0)

    def test_release_stops_output(self):
        pid = make_pid(kp=2.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        assert pid.update(190.0, 1.0) is not None
        pid.release()
        assert pid.update(190.0, 2.0) is None

    def test_resume_rebaselines_time(self):
        """HOLD 5초 뒤 재개해도 dt=5초짜리 적분 폭증이 없어야 한다."""
        pid = make_pid(kp=0.0, ki=1.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        before = pid.snapshot()["i"]
        pid.resume(now=6.0)          # 5초 공백
        pid.update(190.0, 7.0)       # dt = 1초로 재기준
        assert pid.snapshot()["i"] == pytest.approx(before + 10.0)


class TestActuatorBounds:
    def test_requested_output_precedes_actuator_clamp_and_back_calculation(self):
        pid = make_pid(kp=0, ki=1)
        pid.set_target(150)
        pid.engage(0)
        assert pid.update(100, 1, output_bounds=(0, 10)) == 10
        assert pid.requested_output == 50
        assert pid.snapshot()["i"] == 30

    def test_previous_slew_bounds_stop_windup_even_after_window_moves(self):
        pid = make_pid(kp=0, ki=1)
        pid.set_target(150)
        pid.engage(0)
        pid.update(100, 1, output_bounds=(0, 10))
        assert pid.update(100, 2, output_bounds=(0, 100)) == 30

    def test_narrow_window_preserves_absolute_integral_band(self):
        pid = make_pid(kp=0, ki=0)
        pid.set_target(150)
        pid.engage(0, seed_output=70)
        assert pid.update(150, 1, output_bounds=(65, 75)) == 70
        assert pid.snapshot()["i"] == 70

    def test_bounds_intersect_absolute_limits(self):
        pid = make_pid(kp=20)
        pid.set_target(200)
        pid.engage(0)
        assert pid.update(100, 1, output_bounds=(-10, 150)) == 100

    @pytest.mark.parametrize("bounds", [(60, 50), (101, 120), (-10, -1), (0, math.inf), (True, 10)])
    def test_invalid_bounds_reject_before_progression(self, bounds):
        pid = make_pid()
        pid.set_target(200)
        pid.engage(0, seed_output=50)
        with pytest.raises(ValueError):
            pid.update(195, 1, output_bounds=bounds)
        assert pid.update(195, 1) == 50

    def test_omitting_bounds_after_curve_tick_preserves_fixed_integration(self):
        pid = make_pid(kp=0, ki=1)
        pid.set_target(150)
        pid.engage(0)
        pid.update(100, 1, output_bounds=(0, 10))
        assert pid.update(100, 2) == 80


@pytest.mark.parametrize("gains,noise,delay", [
    ((4, 0.3, 2), 0, 0), ((4, 0.3, 2), 0.3, 2), ((20, 0.01, 3), 0, 0),
])
def test_declared_600_tick_saturation_recovery(gains, noise, delay):
    """Frozen fsd02-contract fixture; these are synthetic, not physical, limits."""
    rng = random.Random(216)
    plant = FirstOrderThermalModel(tau=40, heater_gain=2.4, ambient=25, bt0=150)
    pid = SoftwarePid(PidGains(*gains))
    pid.set_target(150)
    duty = (150 - 25) / 2.4
    pid.engage(0, seed_output=duty)
    clock = "a" * 32 + ":1"
    filtered = advance_filter(None, RawObservation(clock, 0, 0, 150))
    samples = [150] * (delay + 1)
    rows = []
    for t in range(1, 601):
        samples.append(plant.step(duty, 1) + rng.uniform(-noise, noise))
        filtered = advance_filter(filtered, RawObservation(clock, t, t, samples[-1 - delay]))
        target = 250 if 20 <= t < 80 else 150
        pid.set_target(target)
        output = pid.update(filtered.value, t, output_bounds=(max(0, duty - 5), min(100, duty + 5)))
        assert output is not None and math.isfinite(output) and 0 <= output <= 100
        assert abs(output - duty) <= 5 + 1e-9
        assert math.isfinite(pid._i_term) and 0 <= pid._i_term <= 100
        duty = output
        rows.append((t, target - filtered.value, duty))
    recovery = next((t - 80 for index, (t, _, _) in enumerate(rows)
                     if t >= 80 and len(rows[index:index + 30]) == 30
                     and all(abs(error) <= 5 for _, error, _ in rows[index:index + 30])), None)
    rmse = math.sqrt(sum(error**2 for _, error, _ in rows[-60:]) / 60)
    assert max(duty for _, _, duty in rows[20:79]) >= 99.9
    assert recovery is not None and recovery <= 120
    assert rmse <= 1
    print(f"saturation gains={gains} noise={noise} delay={delay} recovery={recovery}s final_rmse={rmse:.6f}C")


@pytest.mark.parametrize("noise,delay", [(0, 0), (0.3, 2)])
def test_600_tick_rising_target_with_noise_and_observation_delay(noise, delay):
    rng = random.Random(216)
    plant = FirstOrderThermalModel(bt0=150)
    pid = make_pid(kp=4, ki=0.3, kd=2)
    pid.set_target(150)
    duty = (150 - 25) / 2.4
    pid.engage(0, seed_output=duty)
    clock = "a" * 32 + ":1"
    filtered = advance_filter(None, RawObservation(clock, 0, 0, 150))
    samples = [150] * (delay + 1)
    errors = []
    for t in range(1, 601):
        samples.append(plant.step(duty, 1) + rng.uniform(-noise, noise))
        filtered = advance_filter(filtered, RawObservation(clock, t, t, samples[-1 - delay]))
        target = 150 + t / 10
        pid.set_target(target)
        output = pid.update(filtered.value, t, output_bounds=(max(0, duty - 5), min(100, duty + 5)))
        assert output is not None and math.isfinite(output) and 0 <= output <= 100
        assert abs(output - duty) <= 5 + 1e-9
        assert 0 <= pid._i_term <= 100
        errors.append(target - filtered.value)
        duty = output
    assert max(abs(error) for error in errors) <= 5
    assert math.sqrt(sum(error**2 for error in errors[-60:]) / 60) <= 1

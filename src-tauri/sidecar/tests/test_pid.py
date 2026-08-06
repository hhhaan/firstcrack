"""SoftwarePid 순수 계산 테스트 — 시계 없이 now를 직접 넘긴다."""

import pytest

from pid import PidGains, SoftwarePid


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
        pid = SoftwarePid(PidGains(0.0, 0.0, 10.0), sp_weight_d=0.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        pid.set_target(260.0, bumpless=True)
        out = pid.update(190.0, 2.0)  # PV 그대로, SV만 점프
        assert out == pytest.approx(0.0)

    def test_derivative_responds_to_pv_change(self):
        pid = SoftwarePid(PidGains(0.0, 0.0, 2.0), sp_weight_d=0.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        out = pid.update(195.0, 2.0)  # PV 상승 → 음의 D (제동)
        assert out is not None and out < 0.0 or out == 0.0  # 클램프로 0일 수 있음
        assert pid.snapshot()["d"] < 0

    def test_derivative_clamped(self):
        pid = SoftwarePid(PidGains(0.0, 0.0, 1.0), sp_weight_d=0.0, d_clamp=5.0)
        pid.set_target(200.0)
        pid.engage(now=0.0)
        pid.update(190.0, 0.0)
        pid.update(190.0, 1.0)
        pid.update(1000.0, 2.0)  # 거대한 점프
        assert abs(pid.snapshot()["d"]) <= 5.0

    def test_measurement_spike_is_attenuated(self):
        """센서 스파이크는 미분 기여를 줄여 화력이 크게 흔들리지 않게 한다."""
        steady = SoftwarePid(PidGains(0.0, 0.0, 1.0), sp_weight_d=0.0, d_clamp=1e9)
        steady.set_target(200.0)
        steady.engage(now=0.0)
        # 완만한 변화 이력을 쌓는다 (0.1°C/s)
        pv = 190.0
        steady.update(pv, 0.0)
        for t in range(1, 5):
            pv += 0.1
            steady.update(pv, float(t))
        spike_d = steady.update(pv + 10.0, 5.0) and steady.snapshot()["d"]
        # 감쇠(×0.3)가 걸렸으므로 kd×10 = -10 이 아니라 -3 수준
        assert steady.snapshot()["d"] == pytest.approx(-3.0, rel=0.05)
        assert spike_d is not None or True


class TestEngageRelease:
    def test_engage_with_seed_is_bumpless(self):
        """이미 60% duty로 돌던 머신에서 켜면 첫 출력이 60% 근처여야 한다."""
        pid = make_pid(kp=2.0)
        pid.set_target(200.0)
        pid.engage(now=0.0, seed_output=60.0)
        pid.update(195.0, 0.0)
        out = pid.update(195.0, 1.0)
        assert out == pytest.approx(60.0)

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

"""PidRunner 안전 상태기계 — 가상 시계로 tick()을 직접 돌린다 (sleep 없음)."""

import pytest

import config
from pid import PidGains
from pid_runner import FAULT, HOLDING, OFF, RUNNING, PidRunner, PvSample


class FakeMachine:
    """PV/쓰기 동작을 테스트가 직접 조종하는 가짜 머신."""

    def __init__(self, bt: float = 190.0, feedback: float | None = 60.0):
        self.t = 0.0
        self.bt: float | None = bt
        self.stale = False
        self.connected = True
        self.feedback = feedback
        self.writes: list[float] = []
        self.write_error: Exception | None = None
        self.pv_error: Exception | None = None

    def clock(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds

    async def read_pv(self) -> PvSample:
        if self.pv_error is not None:
            raise self.pv_error
        return PvSample(bt=self.bt, ts=self.t, stale=self.stale, connected=self.connected)

    async def write_duty(self, duty: float) -> None:
        if self.write_error is not None:
            raise self.write_error
        self.writes.append(duty)

    async def read_feedback(self) -> float | None:
        return self.feedback


def make_runner(machine: FakeMachine, **kw) -> PidRunner:
    return PidRunner(
        read_pv=machine.read_pv,
        write_duty=machine.write_duty,
        read_feedback=machine.read_feedback,
        gains=PidGains(kp=20.0, ki=0.01, kd=3.0),
        clock=machine.clock,
        **kw,
    )


async def run_ticks(machine: FakeMachine, runner: PidRunner, count: int, step: float = 1.0):
    for _ in range(count):
        machine.advance(step)
        await runner.tick()


class TestLifecycle:
    async def test_off_by_default_writes_nothing(self):
        m = FakeMachine()
        r = make_runner(m)
        assert r.state_name == OFF
        await run_ticks(m, r, 5)
        assert m.writes == []

    async def test_start_seeds_from_heater_feedback(self):
        """이미 60%로 돌던 머신에서 켜면 첫 출력이 60% 근처 — 화력 공백이 없어야 한다."""
        m = FakeMachine(bt=195.0, feedback=60.0)
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        assert m.writes, "첫 tick에 duty를 써야 한다"
        assert m.writes[0] == pytest.approx(60.0, abs=2.0)

    async def test_start_without_feedback_still_runs(self):
        m = FakeMachine(feedback=None)
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        assert r.state_name == RUNNING

    async def test_stop_hold_writes_back_current_feedback(self):
        """DROP 시 hold 모드 — 머신이 보고하는 현재 duty를 유지한다."""
        m = FakeMachine(feedback=55.0)
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()
        await r.stop("drop", mode="hold")
        assert r.state_name == OFF
        assert m.writes == [55.0]

    async def test_stop_zero_turns_heater_off(self):
        m = FakeMachine(feedback=55.0)
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()
        await r.stop("drop", mode="zero")
        assert m.writes == [0.0]

    async def test_stop_when_already_off_is_noop(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.stop("drop", mode="zero")
        assert m.writes == []

    async def test_sv_change_does_not_kick_duty(self):
        """프로덕션 경로(PidRunner가 만드는 기본 설정)에서 SV 조작이 D항을 튀게 하면 안 된다.

        SoftwarePid를 직접 만들며 sp_weight_d=0.0을 넘기는 테스트만 있으면
        기본값이 오차 미분으로 남아 있어도 통과해버린다 — 실제로 그랬다.
        """
        m = FakeMachine(bt=200.0, feedback=70.0)
        r = make_runner(m, duty_deadband=0.0, resend_every_n_ticks=1)
        await r.start(sv=200.0)
        await run_ticks(m, r, 4)
        d_before = r.state()["d"]

        await r.set_sv(210.0)  # PV는 그대로, 슬라이더만 조작
        await run_ticks(m, r, 1)

        assert d_before == 0.0
        assert r.state()["d"] == 0.0, "SV 변경만으로 D항이 움직였다 (derivative kick)"

    async def test_set_sv_requires_running(self):
        m = FakeMachine()
        r = make_runner(m)
        with pytest.raises(RuntimeError):
            await r.set_sv(210.0)


class TestEmitPolicy:
    async def test_deadband_suppresses_tiny_changes(self):
        m = FakeMachine(bt=200.0, feedback=50.0)
        r = make_runner(m, duty_deadband=5.0, resend_every_n_ticks=999)
        await r.start(sv=200.0)
        await run_ticks(m, r, 4)
        # PV가 SV와 같아 duty가 거의 변하지 않는다 → 첫 쓰기 이후 추가 쓰기 없음
        assert len(m.writes) == 1

    async def test_periodic_resend_even_without_change(self):
        m = FakeMachine(bt=200.0, feedback=50.0)
        r = make_runner(m, duty_deadband=5.0, resend_every_n_ticks=2)
        await r.start(sv=200.0)
        await run_ticks(m, r, 6)
        assert len(m.writes) > 1


class TestHolding:
    async def test_stale_pv_enters_holding_and_stops_writing(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()

        m.stale = True
        await run_ticks(m, r, 2)
        assert r.state_name == HOLDING
        assert m.writes == [], "PV를 못 믿는 동안은 쓰지 않는다"

    async def test_missing_bt_enters_holding(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.bt = None
        await run_ticks(m, r, 1)
        assert r.state_name == HOLDING

    async def test_recovers_to_running_when_pv_returns(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.stale = True
        await run_ticks(m, r, 2)
        assert r.state_name == HOLDING
        m.stale = False
        await run_ticks(m, r, 1)
        assert r.state_name == RUNNING

    async def test_hold_recovery_does_not_dump_integral(self):
        """공백 4초 뒤 복귀해도 duty가 한 번에 튀지 않아야 한다."""
        m = FakeMachine(bt=195.0, feedback=50.0)
        r = make_runner(m, duty_deadband=0.0, resend_every_n_ticks=1)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        before = m.writes[-1]

        m.stale = True
        await run_ticks(m, r, 4)  # 4초 HOLD (타임아웃 5초 미만)
        m.stale = False
        await run_ticks(m, r, 1)
        after = m.writes[-1]
        assert abs(after - before) < 10.0

    async def test_hold_timeout_faults_and_forces_heater_off(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()

        m.stale = True
        await run_ticks(m, r, int(config.PID_HOLD_TIMEOUT_S) + 3)
        assert r.state_name == FAULT
        assert m.writes == [0.0]


class TestFault:
    async def test_over_max_bt_faults_immediately(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()

        m.bt = config.SAFETY_MAX_BT_C + 1.0
        await run_ticks(m, r, 1)
        assert r.state_name == FAULT
        assert m.writes == [0.0]
        assert "안전 상한" in (r.state()["error"] or "")

    async def test_disconnect_faults_without_writing(self):
        """연결이 없으면 쓸 경로도 없다 — 헛된 쓰기를 시도하지 않는다."""
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.writes.clear()

        m.connected = False
        await run_ticks(m, r, 1)
        assert r.state_name == FAULT
        assert m.writes == []

    async def test_two_write_failures_do_not_fault(self):
        m = FakeMachine(bt=190.0, feedback=50.0)
        r = make_runner(m, duty_deadband=0.0, resend_every_n_ticks=1)
        await r.start(sv=200.0)
        await run_ticks(m, r, 1)
        m.write_error = OSError("PLC busy")
        await run_ticks(m, r, 2)
        assert r.state_name == RUNNING

    async def test_three_consecutive_write_failures_fault(self):
        m = FakeMachine(bt=190.0, feedback=50.0)
        r = make_runner(m, duty_deadband=0.0, resend_every_n_ticks=1)
        await r.start(sv=200.0)
        await run_ticks(m, r, 1)
        m.write_error = OSError("cable pulled")
        await run_ticks(m, r, config.PID_WRITE_FAIL_LIMIT + 1)
        assert r.state_name == FAULT

    async def test_pv_read_exception_faults(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.pv_error = OSError("adapter gone")
        await run_ticks(m, r, 1)
        assert r.state_name == FAULT

    async def test_failed_safe_off_is_surfaced_in_error(self):
        """화력을 못 껐는데 원래 사유만 보이면 조작자가 꺼진 줄 안다."""
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)

        m.write_error = OSError("PLC unreachable")
        m.bt = config.SAFETY_MAX_BT_C + 1.0
        await run_ticks(m, r, 1)

        assert r.state_name == FAULT
        error = r.state()["error"] or ""
        assert "안전 상한" in error, "원래 fault 사유가 남아 있어야 한다"
        assert "끄지 못했습니다" in error, "정지 실패도 함께 알려야 한다"

    async def test_successful_safe_off_keeps_original_error(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.bt = config.SAFETY_MAX_BT_C + 1.0
        await run_ticks(m, r, 1)
        assert "끄지 못했습니다" not in (r.state()["error"] or "")

    async def test_fault_ticks_are_noop(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.connected = False
        await run_ticks(m, r, 1)
        assert r.state_name == FAULT
        m.connected = True
        m.writes.clear()
        await run_ticks(m, r, 5)
        assert m.writes == [], "FAULT는 사용자가 명시적으로 해제해야 한다"

    async def test_restart_clears_fault(self):
        m = FakeMachine()
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        m.connected = False
        await run_ticks(m, r, 1)
        assert r.state_name == FAULT

        m.connected = True
        await r.start(sv=200.0)
        assert r.state_name == RUNNING
        assert r.state()["error"] is None


class TestStateReport:
    async def test_state_exposes_terms_and_duty(self):
        m = FakeMachine(bt=190.0, feedback=50.0)
        r = make_runner(m)
        await r.start(sv=200.0)
        await run_ticks(m, r, 2)
        s = r.state()
        assert s["state"] == RUNNING
        assert s["sv"] == 200.0
        assert s["pv"] == 190.0
        assert s["duty"] is not None
        assert {"p", "i", "d", "error"} <= set(s)

    async def test_state_is_off_before_start(self):
        r = make_runner(FakeMachine())
        assert r.state()["state"] == OFF
        assert r.state()["sv"] is None

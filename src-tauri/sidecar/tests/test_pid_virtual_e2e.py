"""폐루프 검증 — PID + 가상 머신 열 모델.

궤적(몇 초에 몇 도)이 아니라 **성질**만 단언한다: 수렴하는가, 계속 진동하지
않는가, duty가 범위를 지키는가. 궤적을 고정하면 게인을 조금만 손봐도 테스트가
깨지고, 정작 중요한 안정성은 검증하지 못한다.

가상 시계로 tick을 직접 돌린다 — 실제 sleep 없이 수천 초를 시뮬레이션한다.

**한계**: 가상 머신 게인은 Ki=0.3으로 실기(Giesen Ki=0.01)의 30배다. 적분항이
어긋나도 몇 분이면 상환되므로 **적분 부채 결함을 여기서는 잡지 못한다**(이슈 #196).
"이 E2E가 통과하니 PID는 괜찮다"로 읽지 말 것 — 실기 게인 회귀는
`test_pid.py::TestIntegralDebt`가 담당한다.
"""

import pytest

from adapters.virtual import VirtualMachineAdapter
from pid import PidGains
from pid_runner import RUNNING, PidRunner, PvSample
from roaster_registry import ROASTER_REGISTRY

VIRTUAL_ENTRY = ROASTER_REGISTRY["virtual"]
VIRTUAL_GAINS = PidGains(
    kp=float(VIRTUAL_ENTRY["pid"]["Kp"]),
    ki=float(VIRTUAL_ENTRY["pid"]["Ki"]),
    kd=float(VIRTUAL_ENTRY["pid"]["Kd"]),
)
HEATER_LIMIT = VIRTUAL_ENTRY["default_params"]["write_map"]["heater"]


class Rig:
    """가상 머신 + PID 러너를 하나의 가상 시계 위에서 돌린다."""

    def __init__(self, sv: float = 200.0):
        self.t = 0.0
        self.adapter = VirtualMachineAdapter(
            sim="thermal",
            write_map=VIRTUAL_ENTRY["default_params"]["write_map"],
            clock=lambda: self.t,
        )
        self.duties: list[float] = []
        self.bts: list[float] = []
        self.sv = sv
        self.runner = PidRunner(
            read_pv=self._read_pv,
            write_duty=self._write_duty,
            read_feedback=self._read_feedback,
            gains=VIRTUAL_GAINS,
            clock=lambda: self.t,
            duty_deadband=0.0,
            resend_every_n_ticks=1,
        )

    async def _read_pv(self) -> PvSample:
        r = await self.adapter.read()
        self.bts.append(r.bt)
        return PvSample(bt=r.bt, ts=self.t, stale=False, connected=True)

    async def _write_duty(self, duty: float) -> None:
        clamped = max(HEATER_LIMIT["min"], min(HEATER_LIMIT["max"], duty))
        self.duties.append(clamped)
        await self.adapter.control(heater=clamped)

    async def _read_feedback(self) -> float | None:
        return (await self.adapter.read()).heater

    async def start(self):
        await self.adapter.connect()
        await self.runner.start(self.sv)

    async def run(self, seconds: int, step: float = 1.0):
        for _ in range(seconds):
            self.t += step
            await self.runner.tick()


@pytest.fixture
async def rig():
    r = Rig()
    await r.start()
    return r


class TestClosedLoop:
    async def test_step_response_settles_near_setpoint(self, rig):
        await rig.run(1200)
        assert rig.bts[-1] == pytest.approx(rig.sv, abs=2.0)

    async def test_no_sustained_oscillation_after_settling(self, rig):
        await rig.run(1200)
        tail = rig.bts[-120:]
        assert max(tail) - min(tail) < 3.0, "정착 후에도 온도가 계속 흔들린다"

    async def test_duty_never_leaves_write_map_range(self, rig):
        await rig.run(1200)
        assert rig.duties, "duty가 한 번도 써지지 않았다"
        assert all(HEATER_LIMIT["min"] <= d <= HEATER_LIMIT["max"] for d in rig.duties)

    async def test_stays_running_through_the_whole_roast(self, rig):
        await rig.run(1200)
        assert rig.runner.state_name == RUNNING
        assert rig.runner.state()["error"] is None

    async def test_heating_actually_responds_to_duty(self):
        """열 모델이 duty에 반응하지 않으면 어떤 게인이든 테스트가 통과해버린다."""
        rig = Rig()
        await rig.adapter.connect()
        await rig.adapter.control(heater=100.0)
        rig.t += 60.0
        hot = (await rig.adapter.read()).bt
        await rig.adapter.control(heater=0.0)
        rig.t += 300.0
        cold = (await rig.adapter.read()).bt
        assert hot > 60.0, "duty 100%인데 데워지지 않았다"
        assert cold < hot, "duty 0%인데 식지 않았다"

    async def test_setpoint_change_converges_to_new_target(self, rig):
        await rig.run(900)
        await rig.runner.set_sv(215.0)
        await rig.run(900)
        assert rig.bts[-1] == pytest.approx(215.0, abs=2.5)

    async def test_stop_zero_cools_the_machine(self, rig):
        await rig.run(600)
        await rig.runner.stop("drop", mode="zero")
        before = rig.bts[-1]
        rig.t += 600.0
        after = (await rig.adapter.read()).bt
        assert after < before


@pytest.mark.parametrize("gains,noise,delay,rising", [
    ((4, 0.3, 2), 0, 0, False),
    ((4, 0.3, 2), 0.3, 2, False),
    ((20, 0.01, 3), 0, 0, False),
    ((4, 0.3, 2), 0, 0, True),
    ((4, 0.3, 2), 0.3, 2, True),
])
async def test_production_curve_runner_600_tick_contract(gains, noise, delay, rising):
    import math
    import random
    from collections import deque
    from adapters.thermal_model import FirstOrderThermalModel
    from pid_runner import CurveRuntime
    from roast_target import (CurveConfig, MachineIdentity, QualifiedTp, RawObservation,
                              RoastTarget, advance_filter)
    rng = random.Random(216)
    now = [0.0]
    clock = "a" * 32 + ":1"
    def target(t):
        return 150 + t / 10 if rising else (250 if 20 <= t < 80 else 150)
    points = tuple(RawObservation(clock, t, t, target(t)) for t in range(602))
    # This declared saturation schedule exercises the runner, not archive-source eligibility.
    schedule = RoastTarget("fixture", "numerical-schedule", MachineIdentity("fixture", "virtual", "virtual"),
                           points, tuple(target(t) for t in range(602)), QualifiedTp(0, 0, 150), 601, 601)
    filtered = None
    for t in range(-10, 1):
        filtered = advance_filter(filtered, RawObservation(clock, t, t, 150))
    config = CurveConfig(kp=gains[0], ki=gains[1], kd=gains[2])
    plant = FirstOrderThermalModel(bt0=150)
    duty = [(150 - 25) / 2.4]
    samples = deque([150] * (delay + 1), maxlen=delay + 1)
    writes = []
    async def read():
        return PvSample(samples[0], now[0], False, True, (clock, now[0]))
    async def write(value):
        duty[0] = value
        writes.append(value)
    async def terminate(reason):
        pytest.fail(f"Unexpected terminal condition {reason}")
    runner = PidRunner(read_pv=read, write_duty=write, gains=PidGains(*gains), clock=lambda: now[0],
                       curve=CurveRuntime(schedule, config, 0, lambda: filtered, terminate))
    runner.start_curve(duty[0], 0)
    rows = []
    for t in range(1, 601):
        now[0] = t
        samples.append(plant.step(duty[0], 1) + rng.uniform(-noise, noise))
        filtered = advance_filter(filtered, RawObservation(clock, t, t, samples[0]))
        previous = duty[0]
        await runner.tick()
        assert runner.state_name == "running"
        assert math.isfinite(duty[0]) and 0 <= duty[0] <= 100
        assert abs(duty[0] - previous) <= 5 + 1e-9
        assert 0 <= runner._pid._i_term <= 100
        rows.append((t, target(t) - filtered.value, duty[0]))
    assert len(writes) == 600
    rmse = math.sqrt(sum(error**2 for _, error, _ in rows[-60:]) / 60)
    assert rmse <= 1
    if rising:
        assert max(abs(error) for _, error, _ in rows) <= 5
    else:
        recovery = next((t - 80 for index, (t, _, _) in enumerate(rows)
                         if t >= 80 and len(rows[index:index + 30]) == 30
                         and all(abs(error) <= 5 for _, error, _ in rows[index:index + 30])), None)
        assert recovery is not None and recovery <= 120
        assert max(duty for _, _, duty in rows[20:79]) >= 99.9
        print(f"runner recovery={recovery}s rmse={rmse:.6f}C gains={gains} noise={noise} delay={delay}")

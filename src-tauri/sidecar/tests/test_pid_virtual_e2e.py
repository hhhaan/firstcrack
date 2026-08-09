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

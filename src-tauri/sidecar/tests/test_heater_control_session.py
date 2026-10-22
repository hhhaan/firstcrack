"""Ownership promises are checked at the actuator and HTTP boundaries."""
import asyncio
import threading
import time
from dataclasses import replace

import pytest
from snap7.util.getters import get_int

from control_guard import ControlUnavailable
from heater_control_session import ControlUncertain
from manager import RoasterManager
from pid import PidGains
from pid_runner import PidRunner, PvSample
from tests.test_s7_write_verification import verified


async def test_cancelled_waiter_retains_physical_writer_until_takeover_drains(verified):
    manager, adapter, plc, registers = verified
    entered, release = threading.Event(), threading.Event()
    writes = []

    def write(db, offset, payload):
        value = get_int(payload, 0)
        if not writes:
            entered.set()
            assert release.wait(3)
        writes.append(value)
        registers[(db, offset)] = bytearray(payload)

    plc.db_write.side_effect = write
    original = asyncio.create_task(manager.control(heater=70))
    assert await asyncio.to_thread(entered.wait, 1)
    original.cancel()
    with pytest.raises(asyncio.CancelledError):
        await original
    takeover = asyncio.create_task(manager.control(heater=20, takeover=True))
    await asyncio.sleep(0.02)
    assert not takeover.done()
    assert manager._heat.state()["pending_writes"] == 1
    release.set()
    assert await takeover == {"heater": 20}
    assert writes == [71, 21]
    assert manager._heat.state()["pending_writes"] == 0


async def test_queued_s7_write_checks_generation_after_throttle(verified):
    manager, adapter, plc, registers = verified
    entered, release = threading.Event(), threading.Event()
    original_throttle = adapter._throttle

    def throttle():
        if not entered.is_set():
            entered.set()
            assert release.wait(3)
        original_throttle()

    adapter._throttle = throttle
    original = asyncio.create_task(manager.control(heater=70))
    assert await asyncio.to_thread(entered.wait, 1)
    takeover = asyncio.create_task(manager.control(heater=20, takeover=True))
    await asyncio.sleep(0)
    release.set()
    with pytest.raises(ConnectionError):
        await original
    assert await takeover == {"heater": 20}
    assert [get_int(call.args[2], 0) for call in plc.db_write.call_args_list] == [21]


async def test_uncertain_takeover_never_acknowledges_or_starts_pid(verified):
    manager, adapter, plc, registers = verified
    entered, release = threading.Event(), threading.Event()
    def write(db, offset, payload):
        entered.set()
        assert release.wait(3)
        registers[(db, offset)] = bytearray(payload)
    plc.db_write.side_effect = write
    manager._heat.barrier_timeout = 0.03
    original = asyncio.create_task(manager.control(heater=70))
    assert await asyncio.to_thread(entered.wait, 1)
    with pytest.raises(ControlUncertain):
        await manager.control(heater=20, takeover=True)
    with pytest.raises(ControlUncertain):
        await manager._heat.start_fixed(180, PidGains(1, 0, 0))
    assert manager._heat.state()["uncertain"]
    assert plc.db_write.call_count == 1
    release.set()
    with pytest.raises((ControlUncertain, ControlUnavailable, ConnectionError)):
        await original
    await manager._heat.drain()
    assert await manager.control(heater=20, takeover=True) == {"heater": 20}


async def test_replay_claim_command_and_retry_are_fenced_after_manual_takeover():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    try:
        old = manager.status()["heater_control"]
        ticket = await manager.claim_replay(old["connection_epoch"], old["generation"])
        await manager.control(heater=70, **ticket)
        await manager.control(heater=20, takeover=True)
        for command in (ticket, {**ticket, "retry_epoch": ticket["connection_epoch"]}):
            with pytest.raises(ControlUnavailable):
                await manager.control(heater=90, **command)
        with pytest.raises(ControlUnavailable):
            await manager.claim_replay(old["connection_epoch"], old["generation"])
        assert manager._adapter._cmd["heater"] == 20
    finally:
        await manager.disconnect()


async def test_pid_and_terminal_commands_use_machine_logical_limits():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    manager._merged_params["write_map"] = {**manager._merged_params["write_map"], "heater": {"min": 15, "max": 40}}
    try:
        await manager.pid_start(250)
        await manager._heat.runner._write_duty(100)
        assert manager._adapter._cmd["heater"] == 40
        assert manager.last_applied()["heater"] == 40
        await manager.pid_stop("zero")
        assert manager._adapter._cmd["heater"] == 15
        assert manager.last_applied()["heater"] == 15
    finally:
        await manager.disconnect()


async def test_duplicate_sample_does_not_integrate_and_postawait_age_holds():
    now = [10.0]
    sample = PvSample(bt=100, ts=10, stale=False, connected=True, sample_id=("clock", 1))
    async def read():
        return sample
    writes = []
    async def write(value):
        writes.append(value)
    runner = PidRunner(read_pv=read, write_duty=write, gains=PidGains(1, 1, 0), clock=lambda: now[0])
    await runner.start(150)
    now[0] = 11
    sample = replace(sample, ts=11, sample_id=("clock", 2))
    await runner.tick()
    integral = runner.state()["i"]
    now[0] = 12
    await runner.tick()
    assert runner.state()["i"] == integral
    assert len(writes) == 1
    async def delayed_read():
        now[0] = 30
        return sample
    runner._read_pv = delayed_read
    await runner.tick()
    assert runner.state_name == "holding"
    assert len(writes) == 1


async def test_stopped_runner_does_not_fault_or_write_when_read_returns_late():
    entered, release = asyncio.Event(), asyncio.Event()
    async def read():
        entered.set()
        await release.wait()
        return PvSample(bt=300, ts=time.monotonic(), stale=False, connected=True)
    writes = []
    async def write(value):
        writes.append(value)
    runner = PidRunner(read_pv=read, write_duty=write, gains=PidGains(1, 0, 0))
    await runner.start(150)
    tick = asyncio.create_task(runner.tick())
    await entered.wait()
    await runner.stop(mode="zero")
    release.set()
    await tick
    assert runner.state_name == "off"
    assert writes == [0]


@pytest.mark.parametrize("timestamp, clock", [(float("nan"), "clock"), (float("inf"), "clock"), (11, "clock"), (8, "clock"), (10, "foreign")])
async def test_invalid_acquisition_cannot_advance_pid(timestamp, clock):
    now = [9.0]
    sample = PvSample(100, 9, False, True, ("clock", 1))
    async def read():
        return sample
    writes = []
    async def write(value):
        writes.append(value)
    runner = PidRunner(read_pv=read, write_duty=write, gains=PidGains(1, 1, 0), clock=lambda: now[0])
    await runner.start(150)
    await runner.tick()
    before = runner.state()["i"]
    now[0] = 10
    sample = PvSample(100, timestamp, False, True, (clock, 2))
    await runner.tick()
    assert runner.state_name == "holding"
    assert runner.state()["i"] == before
    assert writes == []


async def test_zero_stop_supersedes_pending_hold_feedback_without_false_ack():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    await manager.pid_start(200)
    entered, release = asyncio.Event(), asyncio.Event()
    async def feedback():
        entered.set()
        await release.wait()
        return 80
    manager._heat.runner._read_feedback = feedback
    hold = asyncio.create_task(manager.pid_stop("hold"))
    try:
        await entered.wait()
        assert manager._heat.state()["stopping"]
        result = await manager.pid_stop("zero")
        assert result["state"] == "off"
        assert manager._adapter._cmd["heater"] == 0
        release.set()
        with pytest.raises(ControlUnavailable):
            await hold
        assert manager.pid_state()["state"] == "off"
        assert manager.pid_state()["error"] is None
        assert manager._adapter._cmd["heater"] == 0
    finally:
        release.set()
        await manager.disconnect()


async def test_cancelled_hold_retains_terminal_obligation_for_zero_retry():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    await manager.pid_start(200)
    entered = asyncio.Event()
    async def feedback():
        entered.set()
        await asyncio.Event().wait()
    manager._heat.runner._read_feedback = feedback
    hold = asyncio.create_task(manager.pid_stop("hold"))
    await entered.wait()
    hold.cancel()
    with pytest.raises(asyncio.CancelledError):
        await hold
    assert manager._heat.state()["stopping"]
    try:
        await manager.pid_stop("zero")
        assert manager._adapter._cmd["heater"] == 0
        assert not manager._heat.state()["stopping"]
    finally:
        await manager.disconnect()


async def test_owned_pid_reports_disconnection_fault_without_attempting_a_write():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.pid_start(200)
    manager._connected = False
    await manager._heat.runner.tick()
    assert manager.pid_state()["state"] == "fault"
    assert manager._adapter._cmd == {}
    await manager.disconnect()


async def test_delayed_empty_terminal_barrier_cannot_revoke_new_manual_owner():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    entered, release = asyncio.Event(), asyncio.Event()
    adapter = manager._adapter
    control = adapter.control
    async def delayed(**kwargs):
        if "fan" in kwargs:
            entered.set()
            await release.wait()
        await control(**kwargs)
    adapter.control = delayed
    fan = asyncio.create_task(manager.control(fan=40))
    await entered.wait()
    terminal = asyncio.create_task(manager._heat.stop(mode="zero"))
    await asyncio.sleep(0)
    manual = asyncio.create_task(manager.control(heater=25, takeover=True))
    await asyncio.sleep(0)
    release.set()
    try:
        await fan
        with pytest.raises(ControlUnavailable):
            await terminal
        assert await manual == {"heater": 25}
        assert manager._adapter._cmd["heater"] == 25
    finally:
        await manager.disconnect()


async def test_failed_pid_engage_after_disconnect_retains_fault_for_reconnect_zero():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    async def failed_read():
        raise ConnectionError("probe disconnected during engage")
    adapter = manager._adapter
    original_read = adapter.read
    adapter.read = failed_read
    manager._last_good = None
    try:
        with pytest.raises(ControlUnavailable):
            await manager.pid_start(200)
        assert manager.pid_state()["state"] == "fault"
        assert manager.pid_state()["error"]
        assert manager._heat.task is None
        adapter.read = original_read
        manager._connected = True
        await manager._safety_after_reconnect()
        assert manager.pid_state()["state"] == "off"
        assert adapter._cmd["heater"] == 0
    finally:
        await manager.disconnect()


async def test_superseded_pid_engage_cannot_fault_newer_manual_owner():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    entered, release = asyncio.Event(), asyncio.Event()
    async def feedback():
        entered.set()
        await release.wait()
        return 80
    manager._heat._read_feedback = feedback
    engage = asyncio.create_task(manager.pid_start(200))
    await entered.wait()
    try:
        await manager.control(heater=20, takeover=True)
        release.set()
        with pytest.raises(ControlUnavailable):
            await engage
        assert manager.pid_state()["state"] == "off"
        assert manager.pid_state()["error"] is None
        assert manager._adapter._cmd["heater"] == 20
    finally:
        release.set()
        await manager.disconnect()


async def test_cancelled_pid_engage_retains_recoverable_fault():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    entered = asyncio.Event()
    async def feedback():
        entered.set()
        await asyncio.Event().wait()
    manager._heat._read_feedback = feedback
    engage = asyncio.create_task(manager.pid_start(200))
    await entered.wait()
    engage.cancel()
    with pytest.raises(asyncio.CancelledError):
        await engage
    try:
        assert manager.pid_state()["state"] == "fault"
        assert manager._heat.task is None
        await manager.pid_stop("zero")
        assert manager.pid_state()["state"] == "off"
        assert manager._adapter._cmd["heater"] == 0
    finally:
        await manager.disconnect()


async def test_disconnect_retains_cancelled_s7_driver_until_completion(verified):
    manager, adapter, plc, registers = verified
    entered, release = threading.Event(), threading.Event()

    def write(db, offset, payload):
        entered.set()
        assert release.wait(3)
        registers[(db, offset)] = bytearray(payload)

    plc.db_write.side_effect = write
    writer = asyncio.create_task(manager.control(heater=70))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        writer.cancel()
        with pytest.raises(asyncio.CancelledError):
            await writer
        manager._heat.barrier_timeout = 0.02
        with pytest.raises(ControlUncertain):
            await manager.disconnect()
        assert manager._adapter is adapter
        assert manager._heat.state()["pending_writes"] == 1
        assert manager._heat.state()["uncertain"]
        with pytest.raises(ControlUncertain):
            await manager.connect("virtual", {}, machine_id="new")
        assert manager._adapter is adapter
        assert manager._heat.state()["pending_writes"] == 1
        plc.disconnect.assert_not_called()
        release.set()
        manager._heat.barrier_timeout = 2
        await manager.disconnect()
        assert manager._adapter is None
        assert manager._heat.state()["pending_writes"] == 0
        assert not manager._heat.state()["uncertain"]
        plc.disconnect.assert_called_once()
    finally:
        release.set()
        await asyncio.gather(writer, return_exceptions=True)

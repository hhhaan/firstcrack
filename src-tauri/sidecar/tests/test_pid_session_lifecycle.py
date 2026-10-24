"""An admitted PID operation owns terminal duty through every await boundary."""
import asyncio

import pytest

from control_guard import ControlUnavailable
from heater_control_session import ControlUncertain
from manager import RoasterManager


@pytest.fixture(params=["feedback", "drain"])
async def pending_start(request):
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    adapter = manager._adapter
    entered, release = asyncio.Event(), asyncio.Event()
    commands = []
    original_read, original_control = adapter.read, adapter.control

    async def read():
        entered.set()
        await release.wait()
        return await original_read()

    async def control(**values):
        if request.param == "drain" and "fan" in values:
            entered.set()
            await release.wait()
        await original_control(**values)
        if "heater" in values:
            commands.append(adapter._cmd["heater"])

    adapter.control = control
    writer = None
    if request.param == "feedback":
        adapter.read = read
    else:
        writer = asyncio.create_task(manager.control(fan=40))
        await asyncio.wait_for(entered.wait(), 1)
    engage = asyncio.create_task(manager.pid_start(200))
    if request.param == "feedback":
        await asyncio.wait_for(entered.wait(), 1)
    else:
        await asyncio.sleep(0)
    assert manager._heat.state()["starting"]
    try:
        yield manager, engage, release, commands
    finally:
        release.set()
        await asyncio.gather(engage, *([writer] if writer else []), return_exceptions=True)
        await manager.disconnect()


@pytest.mark.parametrize("terminal", ["zero", "disconnect", "reset"])
async def test_terminal_disposes_pending_start_before_acknowledging(pending_start, terminal):
    manager, engage, release, commands = pending_start
    adapter = manager._adapter
    if terminal == "zero":
        stopping = asyncio.create_task(manager.pid_stop("zero"))
    elif terminal == "disconnect":
        stopping = asyncio.create_task(manager.disconnect())
    else:
        stopping = asyncio.create_task(manager.reset_roast())
    await asyncio.sleep(0)
    if manager._heat.state()["pending_writes"]:
        assert not stopping.done()
    release.set()
    await stopping
    assert commands == [0]
    assert adapter._cmd["heater"] == 0
    with pytest.raises(ControlUnavailable):
        await engage
    assert not manager._heat.state()["starting"]
    assert not manager._heat.state()["stopping"]


async def test_cancelled_start_keeps_fault_and_reconnect_terminal_duty(pending_start):
    manager, engage, release, commands = pending_start
    engage.cancel()
    with pytest.raises(asyncio.CancelledError):
        await engage
    assert manager.pid_state()["state"] == "fault"
    assert manager.pid_state()["error"]
    assert manager._adapter._cmd["heater"] == 80
    manager._heat.revoke()
    manager._connection_epoch += 1
    terminal = asyncio.create_task(manager._safety_after_reconnect())
    release.set()
    await terminal
    assert commands == [0]
    assert manager._adapter._cmd["heater"] == 0
    assert manager.pid_state()["state"] == "off"


async def test_new_start_supersedes_old_start_without_late_status_changes(pending_start):
    manager, engage, release, commands = pending_start
    newer = asyncio.create_task(manager.pid_start(210))
    await asyncio.sleep(0)
    release.set()
    assert (await newer)["state"] == "running"
    with pytest.raises(ControlUnavailable):
        await engage
    assert manager.pid_state()["sv"] == 210
    assert manager._heat.task is not None
    assert not manager._heat.task.done()
    assert commands == []
    await manager.pid_stop("zero")
    assert commands == [0]


async def test_zero_supersedes_repeated_pending_starts(pending_start):
    manager, engage, release, commands = pending_start
    newer = asyncio.create_task(manager.pid_start(210))
    await asyncio.sleep(0)
    terminal = asyncio.create_task(manager.pid_stop("zero"))
    await asyncio.sleep(0)
    release.set()
    assert (await terminal)["state"] == "off"
    for start in (engage, newer):
        with pytest.raises(ControlUnavailable):
            await start
    assert commands == [0]
    assert manager.pid_state()["state"] == "off"
    assert manager._heat.task is None
    await manager.pid_stop("zero")
    assert commands == [0]


async def test_failed_zero_during_start_remains_faulted_until_real_zero(pending_start):
    manager, engage, release, commands = pending_start
    adapter = manager._adapter
    original_control = adapter.control

    async def failed_zero(**values):
        if values.get("heater") == 0:
            raise OSError("zero rejected")
        await original_control(**values)

    adapter.control = failed_zero
    terminal = asyncio.create_task(manager.pid_stop("zero"))
    await asyncio.sleep(0)
    release.set()
    with pytest.raises(OSError, match="zero rejected"):
        await terminal
    with pytest.raises(ControlUnavailable):
        await engage
    assert manager.pid_state()["state"] == "fault"
    assert manager.pid_state()["error"]
    assert manager._heat.state()["stopping"]
    assert commands == []
    assert adapter._cmd["heater"] == 80
    adapter.control = original_control
    assert (await manager.pid_stop("zero"))["state"] == "off"
    assert commands == [0]
    assert adapter._cmd["heater"] == 0


async def test_cancelled_zero_keeps_writer_barrier_and_retriable_fault(pending_start):
    manager, engage, release, commands = pending_start
    adapter = manager._adapter
    original_control = adapter.control
    zero_entered, zero_release = asyncio.Event(), asyncio.Event()

    async def blocked_zero(**values):
        if values.get("heater") == 0 and not zero_entered.is_set():
            zero_entered.set()
            await zero_release.wait()
        await original_control(**values)

    adapter.control = blocked_zero
    terminal = asyncio.create_task(manager.pid_stop("zero"))
    await asyncio.sleep(0)
    release.set()
    try:
        await asyncio.wait_for(zero_entered.wait(), 1)
        terminal.cancel()
        with pytest.raises(asyncio.CancelledError):
            await terminal
        assert manager.pid_state()["state"] == "fault"
        assert manager._heat.state()["stopping"]
        retry = asyncio.create_task(manager.pid_stop("zero"))
        await asyncio.sleep(0)
        assert not retry.done()
        assert commands == []
        zero_release.set()
        assert (await retry)["state"] == "off"
        assert commands == [0]
        assert adapter._cmd["heater"] == 0
        with pytest.raises(ControlUnavailable):
            await engage
    finally:
        zero_release.set()


async def test_failed_automatic_safe_off_retains_explicit_zero_retry():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    await manager.pid_start(200)
    adapter = manager._adapter
    original_control = adapter.control

    async def failed_zero(**values):
        raise OSError("zero rejected")

    adapter.control = failed_zero
    try:
        await manager._heat.runner._fault("test fault", attempt_safe_off=True)
        assert manager.pid_state()["state"] == "fault"
        assert manager.pid_state()["error"]
        assert not manager._heat.state()["stopping"]
        assert adapter._cmd["heater"] == 80
        adapter.control = original_control
        await manager.pid_stop("zero")
        assert adapter._cmd["heater"] == 0
        assert manager.pid_state()["state"] == "off"
    finally:
        adapter.control = original_control
        await manager.disconnect()


async def test_successful_automatic_safe_off_is_faulted_but_not_stopping():
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    await manager.pid_start(200)
    try:
        await manager._heat.runner._fault("test fault", attempt_safe_off=True)
        assert manager._adapter._cmd["heater"] == 0
        assert manager.pid_state()["state"] == "fault"
        assert not manager._heat.state()["stopping"]
        await manager.pid_stop("zero")
        assert manager.pid_state()["state"] == "off"
    finally:
        await manager.disconnect()


async def test_manual_takeover_clears_pending_start_without_late_fault(pending_start):
    manager, engage, release, commands = pending_start
    manual = asyncio.create_task(manager.control(heater=25, takeover=True))
    await asyncio.sleep(0)
    release.set()
    assert await manual == {"heater": 25}
    with pytest.raises(ControlUnavailable):
        await engage
    assert commands == [25]
    assert manager.pid_state()["state"] == "off"
    assert manager.pid_state()["error"] is None
    await manager._safety_after_reconnect()
    assert commands == [25]


async def test_latest_zero_supersedes_pending_terminal_barrier(pending_start):
    manager, engage, release, commands = pending_start
    first = asyncio.create_task(manager.pid_stop("hold"))
    await asyncio.sleep(0)
    second = asyncio.create_task(manager.pid_stop("zero"))
    await asyncio.sleep(0)
    release.set()
    assert (await second)["state"] == "off"
    with pytest.raises(ControlUnavailable):
        await first
    with pytest.raises(ControlUnavailable):
        await engage
    assert commands == [0]
    assert manager._adapter._cmd["heater"] == 0


@pytest.mark.parametrize("transition", ["start", "fault"])
async def test_drain_timeout_preserves_terminal_duty_and_blocks_safe_off_retries(transition):
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    if transition == "fault":
        await manager.pid_start(200)
    adapter = manager._adapter
    original_control = adapter.control
    entered, release = asyncio.Event(), asyncio.Event()
    commands = []

    async def blocked_fan(**values):
        if "fan" in values:
            entered.set()
            await release.wait()
        await original_control(**values)
        if "heater" in values:
            commands.append(adapter._cmd["heater"])

    adapter.control = blocked_fan
    fan = asyncio.create_task(manager.control(fan=40))
    await asyncio.wait_for(entered.wait(), 1)
    manager._heat.barrier_timeout = 0.01
    try:
        if transition == "start":
            with pytest.raises(ControlUncertain):
                await manager.pid_start(200)
        else:
            await manager._heat.runner._fault("test fault", attempt_safe_off=True)
        assert manager.pid_state()["state"] == "fault"
        assert manager.pid_state()["error"]
        assert manager._heat.state()["pending_writes"] == 1
        assert manager._heat.state()["uncertain"]
        assert commands == []
        assert adapter._cmd["heater"] == 80
        release.set()
        await fan
        await manager.pid_stop("zero")
        assert commands == [0]
        assert adapter._cmd["heater"] == 0
        assert manager.pid_state()["state"] == "off"
    finally:
        release.set()
        await asyncio.gather(fan, return_exceptions=True)
        await manager.disconnect()


@pytest.mark.parametrize("replace_directly", [False, True])
async def test_failed_disconnect_minimum_cannot_follow_a_new_machine(replace_directly):
    manager = RoasterManager()
    await manager.connect("virtual", {}, machine_id="old")
    await manager.control(heater=80)
    await manager.pid_start(200)
    old_adapter = manager._adapter

    async def failed_zero(**values):
        raise OSError("minimum rejected")

    old_adapter.control = failed_zero
    try:
        if not replace_directly:
            await manager.disconnect()
            assert manager.pid_state() is None
        await manager.connect("virtual", {}, machine_id="new")
        new_adapter = manager._adapter
        new_adapter._cmd["heater"] = 55
        assert new_adapter is not old_adapter
        assert old_adapter._cmd["heater"] == 80
        assert manager.pid_state() is None
        assert (await manager.pid_stop("zero"))["state"] == "off"
        assert new_adapter._cmd["heater"] == 55
        assert not manager._heat.state()["stopping"]
    finally:
        await manager.disconnect()


async def test_failed_minimum_survives_same_adapter_automatic_reconnect(monkeypatch):
    import config

    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    manager = RoasterManager()
    await manager.connect("virtual", {}, machine_id="same")
    await manager.control(heater=80)
    await manager.pid_start(200)
    adapter = manager._adapter
    original_control = adapter.control
    commands = []

    async def failed_zero(**values):
        raise OSError("minimum rejected")

    async def record(**values):
        await original_control(**values)
        commands.append(values["heater"])

    adapter.control = failed_zero
    try:
        with pytest.raises(OSError, match="minimum rejected"):
            await manager.pid_stop("zero")
        assert manager.pid_state()["state"] == "fault"
        adapter.control = record
        manager._connected = False
        await manager._reconnect_loop()
        assert manager._adapter is adapter
        assert commands == [0]
        assert adapter._cmd["heater"] == 0
        assert manager.pid_state()["state"] == "off"
    finally:
        adapter.control = original_control
        await manager.disconnect()


@pytest.mark.parametrize("timeout", [False, True])
async def test_disconnect_drains_takeover_admitted_during_final_minimum(timeout):
    manager = RoasterManager()
    await manager.connect("virtual", {})
    await manager.control(heater=80)
    await manager.pid_start(200)
    adapter = manager._adapter
    original_control = adapter.control
    zero_done, entered, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def blocked(**values):
        if values.get("heater") == 55:
            entered.set()
            await release.wait()
        await original_control(**values)
        if values.get("heater") == 0:
            asyncio.get_running_loop().call_soon(zero_done.set)

    async def takeover():
        await zero_done.wait()
        return await manager.control(heater=55, takeover=True)

    adapter.control = blocked
    manager._heat.barrier_timeout = 0.03 if timeout else 2
    manual = asyncio.create_task(takeover())
    disconnect = asyncio.create_task(manager.disconnect())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        for _ in range(30):
            await asyncio.sleep(0)
        assert not disconnect.done()
        assert manager._adapter is adapter
        assert manager._heat.state()["pending_writes"] == 1
        with pytest.raises(ControlUnavailable):
            await manager.control(fan=20)
        if timeout:
            with pytest.raises(ControlUncertain):
                await disconnect
            assert manager._adapter is adapter
            assert manager._heat.state()["pending_writes"] == 1
            assert manager._heat.state()["uncertain"]
            with pytest.raises(ControlUncertain):
                await manager.connect("virtual", {}, machine_id="new")
            assert manager._adapter is adapter
        release.set()
        await asyncio.gather(manual, return_exceptions=True)
        if not timeout:
            await disconnect
        else:
            await manager.disconnect()
        assert manager._adapter is None
        assert manager._heat.state()["pending_writes"] == 0
        assert not manager._heat.state()["uncertain"]
    finally:
        release.set()
        await asyncio.gather(manual, disconnect, return_exceptions=True)
        await manager.disconnect()

"""Curve authority uses real session/runner paths with a deterministic acquisition clock."""
import asyncio
from copy import deepcopy
from dataclasses import asdict
import uuid

import pytest

from control_guard import ControlUnavailable
from heater_control_session import HeaterControlSession, CurveError, ControlUncertain
from manager import RoasterManager
from pid_runner import PvSample
from tests.test_roast_target import CLOCK, MACHINE, PROCESSING, reference


class ObservedAdapter:
    def __init__(self):
        self.writes = []
        self.entered = asyncio.Event()
        self.release = None
        self.partial_failure = False

    async def control(self, *, heater=None, _is_current=None, _heater_observer=None, **kwargs):
        if _is_current and not _is_current():
            raise ControlUnavailable("fenced")
        if self.release is not None and heater != 0:
            self.entered.set()
            await self.release.wait()
        if heater is not None:
            self.writes.append(heater)
            if _heater_observer:
                _heater_observer("virtual_applied", heater)
        if self.partial_failure:
            raise OSError("later fan step failed")


@pytest.fixture
async def fixture():
    now = [1040.0]
    adapter = ObservedAdapter()
    latest = [None]
    applied = []
    async def read():
        row = latest[0]
        return PvSample(row["bt_raw"], row["timestamp"], False, True,
                        (row["sensor_clock"], row["timestamp"]))
    async def feedback():
        return 50
    session = HeaterControlSession(epoch=lambda: 1, adapter=lambda: adapter, available=lambda: True,
        read_pv=read, read_feedback=feedback, applied=lambda values: applied.append(values),
        limits=lambda: {"heater": {"min": 0, "max": 100, "unit": "%"}},
        machine=lambda: MACHINE, sensor_clock=lambda: CLOCK,
        curve_capability=lambda: {"supported": True}, read_raw=read, clock=lambda: now[0])
    source = reference()
    def acquire(t, bt=None):
        row = source["points"][t] if t < len(source["points"]) else source["points"][-1]
        payload = {"sensor_clock": CLOCK, "timestamp": 1000 + t,
                   "bt_raw": row["bt_c"] if bt is None else bt, "processing": PROCESSING,
                   "heater": 50, "stale": False}
        now[0] = 1000 + t
        latest[0] = payload
        session.observe_raw(payload)
    for t in range(41):
        acquire(t)
    charge_request = {"session_id": "live-roast", "sensor_clock": CLOCK, "connection_epoch": 1,
                      "expected_generation": 0, "origin": {"kind": "sample", "sample": {
                          "sensor_clock": CLOCK, "acquired_at": 1000.0}}}
    charge, _ = session.accept_charge(charge_request)
    def start_request():
        return {"mode": "curve", "session_id": "live-roast", "charge_id": charge["charge"]["charge_id"],
                "request_id": str(uuid.uuid4()), "sensor_clock": CLOCK, "connection_epoch": 1,
                "expected_generation": session.ticket.generation, "machine": asdict(MACHINE),
                "config_id": "virtual-v1", "reference": deepcopy(source)}
    yield session, adapter, now, acquire, start_request, charge_request, applied
    if adapter.release:
        adapter.release.set()
    if session._lease_handle:
        session._lease_handle.cancel()
    if session.task:
        session.task.cancel()
        await asyncio.gather(session.task, return_exceptions=True)
    await asyncio.gather(*session._terminal_tasks, return_exceptions=True)
    await session.drain()


@pytest.fixture
def expire_curve(monkeypatch):
    async def expire(session, *, terminal=True):
        expired = asyncio.get_running_loop().create_future()
        original = session._begin_curve_end
        def begin(reason):
            task = original(reason)
            expired.set_result(task)
            return task
        with monkeypatch.context() as patch:
            patch.setattr(session, "_begin_curve_end", begin)
            # Bound watchdog dispatch and completion together, without assuming loop turns fit in 10 ms.
            async with asyncio.timeout(0.25):
                session._schedule_lease()
                task = await expired
                if terminal:
                    await asyncio.shield(task)
    return expire


async def test_charge_is_immutable_duplicate_and_anchor_replay_qualify_tp(fixture):
    session, adapter, now, acquire, start, request, _ = fixture
    original = session.charge_response()["charge"]
    response, notify = session.accept_charge({**request, "expected_generation": 900})
    assert not notify and response["charge"] == original
    assert session.eligibility()["eligible"]
    assert session.eligibility()["live_tp"]["minimum_elapsed_sec"] == 25
    changed = deepcopy(request)
    changed["origin"]["sample"]["acquired_at"] = 1001
    with pytest.raises(CurveError, match="charge_conflict"):
        session.accept_charge(changed)
    assert session.ticket.generation == 0
    assert adapter.writes == []


async def test_curve_idempotency_does_not_renew_or_apply_and_terminal_retry_cannot_stop_new_run(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    request = start()
    first = await session.start_curve(request)
    authority = first["curve"]["authority"]
    deadline = first["curve"]["lease_deadline"]
    now[0] += 1
    duplicate = await session.start_curve(deepcopy(request))
    assert duplicate["curve"]["authority"] == authority
    assert duplicate["curve"]["lease_deadline"] == deadline
    assert not adapter.writes
    changed = deepcopy(request)
    changed["reference"]["source_session_id"] = "another"
    with pytest.raises(CurveError, match="request_conflict"):
        await session.start_curve(changed)
    stopped = await session.stop_curve({"mode": "curve", "authority": authority, "reason": "user"})
    assert stopped["curve"]["phase"] == "terminal"
    assert adapter.writes == [0]
    acquire(42)
    second = await session.start_curve(start())
    assert second["curve"]["authority"]["run_id"] != authority["run_id"]
    assert (await session.start_curve(request))["curve"]["phase"] == "terminal"
    assert (await session.stop_curve({"mode": "curve", "authority": authority, "reason": "drop"}))["curve"] == stopped["curve"]
    assert session.curve_snapshot()["authority"] == second["curve"]["authority"]


async def test_lease_admission_rejects_at_exact_deadline_before_watchdog_and_read_cannot_renew(fixture, expire_curve):
    session, adapter, now, acquire, start, *_ = fixture
    started = await session.start_curve(start())
    ticket = session.ticket
    now[0] = started["curve"]["lease_deadline"]
    assert not session.current(ticket)
    with pytest.raises(CurveError, match="stale_authority"):
        session.renew(started["curve"]["authority"])
    with pytest.raises(ControlUnavailable):
        await session.runner._write_duty(100)
    assert not adapter.writes
    assert session.status_fields()["curve"]["lease_deadline"] == now[0]
    await expire_curve(session)
    assert session.curve_snapshot()["reason"] == "lease_expired"
    assert session.curve_snapshot()["phase"] == "terminal"
    assert adapter.writes == [0]


async def test_runner_writes_once_per_raw_identity_and_does_not_integrate_cached_reads(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    started = await session.start_curve(start())
    authority = started["curve"]["authority"]
    for t in (41, 42, 43):
        acquire(t)
        session.renew(authority)
        await session.runner.tick()
        snapshot = session.runner.state()
        count = len(adapter.writes)
        await session.runner.tick()
        assert len(adapter.writes) == count
        assert session.runner.state()["i"] == snapshot["i"]
    assert len(adapter.writes) == 3
    assert all(abs(b - a) <= 5.000001 for a, b in zip([50] + adapter.writes, adapter.writes))
    page = session.receipts(authority["charge_id"])
    assert [row["event"] for row in page["receipts"]] == ["attempt", "transmitted", "completed"] * 3
    assert all(row["attempt_sequence"] == 1 for row in page["receipts"][:3])


async def test_reference_exhaustion_and_drop_terminal_receipts_keep_elapsed(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    started = await session.start_curve(start())
    now[0] = 1060
    # A separate explicit renewal is needed; the old lease cannot be extended after expiry.
    session._operation = __import__("dataclasses").replace(session._operation,
        mode=__import__("dataclasses").replace(session._operation.mode, lease_deadline=1063))
    await session.runner.tick()
    assert session.curve_snapshot()["reason"] == "reference_exhausted"
    assert session._charge["state"] == "open"
    assert adapter.writes == [0]
    receipts = session.receipts(started["curve"]["authority"]["charge_id"])["receipts"]
    assert all(row["elapsed_sec"] == 60 for row in receipts)


async def test_gap_holds_then_terminates_without_rewarming_inside_hold_timeout(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    started = await session.start_curve(start())
    authority = started["curve"]["authority"]
    for t in range(41, 51):
        now[0] = 1000 + t
        session.renew(authority)
        if t >= 44:
            acquire(t)
        await session.runner.tick()
        if not session.is_curve():
            break
    assert session.curve_snapshot()["reason"] == "sample_fault"
    assert adapter.writes == [0]


async def test_timeout_reconciles_original_attempt_after_manual_takeover(fixture):
    session, adapter, now, acquire, start, _, applied = fixture
    started = await session.start_curve(start())
    authority = started["curve"]["authority"]
    adapter.release = asyncio.Event()
    session.barrier_timeout = 0.01
    write = asyncio.create_task(session.runner._write_duty(70))
    await adapter.entered.wait()
    with pytest.raises(ControlUncertain):
        await write
    with pytest.raises(ControlUncertain):
        await session.control({"heater": 20}, takeover=True)
    assert session.is_curve() and session.curve_snapshot()["reason"] == "manual_takeover"
    adapter.release.set()
    await session.drain()
    await session.control({"heater": 20}, takeover=True)
    page = session.receipts(authority["charge_id"])
    events = page["receipts"]
    uncertain = next(row for row in events if row["event"] == "uncertain")
    reconciled = next(row for row in events if row["event"] == "reconciliation")
    assert reconciled["reconciles_sequence"] == uncertain["sequence"]
    assert reconciled["attempt_sequence"] == 1
    assert reconciled["run_id"] == authority["run_id"]
    assert applied == [{"heater": 20}]
    assert session.curve_snapshot()["phase"] == "terminal"


async def test_partial_heater_transmission_survives_mixed_role_failure(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    adapter.partial_failure = True
    with pytest.raises(OSError):
        await session.control({"heater": 30, "fan": 20})
    entries = session.receipts(session._charge["charge_id"])["receipts"]
    assert [row["event"] for row in entries] == ["attempt", "transmitted", "uncertain"]
    assert entries[1]["acknowledged_heat_set"] == 30
    assert entries[1]["evidence"] == "virtual_applied"


async def test_receipt_overflow_cursor_and_retirement(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    charge_id = session._charge["charge_id"]
    for _ in range(700):
        await session.control({"heater": 30})
    page = session.receipts(charge_id, limit=512)
    assert page["gap"] == {"from": 1, "through": 52}
    assert page["first_available"] == 53
    assert page["next_sequence"] == 2101 and page["has_more"]
    page["receipts"][0]["event"] = "mutated"
    assert session.receipts(charge_id)["receipts"][0]["event"] != "mutated"
    with pytest.raises(CurveError) as error:
        session.receipts(charge_id, after=2101)
    assert error.value.status == 400
    await session.retire_connection()
    with pytest.raises(CurveError) as error:
        session.receipts(charge_id)
    assert error.value.status == 410


async def test_watchdog_revokes_starting_operation_while_drain_is_blocked(fixture, expire_curve):
    session, adapter, now, acquire, start, *_ = fixture
    adapter.release = asyncio.Event()
    manual = asyncio.create_task(session.control({"heater": 40}))
    await adapter.entered.wait()
    begin = asyncio.create_task(session.start_curve(start()))
    await asyncio.sleep(0)
    assert session.curve_snapshot()["phase"] == "starting"
    original_ticket = session.ticket
    now[0] = session.curve_snapshot()["lease_deadline"]
    await expire_curve(session, terminal=False)
    assert not session.owns(original_ticket)
    assert session.curve_snapshot()["reason"] == "lease_expired"
    adapter.release.set()
    await asyncio.gather(manual, begin, return_exceptions=True)
    await asyncio.gather(*session._terminal_tasks, return_exceptions=True)
    assert adapter.writes == [40, 0]
    assert session.curve_snapshot()["phase"] == "terminal"


async def test_blocked_read_cannot_delay_expiry_or_overwrite_terminal_state(fixture, expire_curve):
    session, adapter, now, acquire, start, *_ = fixture
    await session.start_curve(start())
    entered, release = asyncio.Event(), asyncio.Event()
    async def read():
        entered.set()
        await release.wait()
        return PvSample(300, now[0], False, True, (CLOCK, now[0]))
    session.runner._read_pv = read
    tick = asyncio.create_task(session.runner.tick())
    await entered.wait()
    now[0] = session.curve_snapshot()["lease_deadline"]
    await expire_curve(session)
    assert session.curve_snapshot()["phase"] == "terminal"
    release.set()
    await tick
    assert adapter.writes == [0]
    assert session.curve_snapshot()["reason"] == "lease_expired"


async def test_stop_while_starting_retains_minimum_and_does_not_reengage(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    adapter.release = asyncio.Event()
    manual = asyncio.create_task(session.control({"heater": 70}))
    await adapter.entered.wait()
    begin = asyncio.create_task(session.start_curve(start()))
    await asyncio.sleep(0)
    authority = session.curve_snapshot()["authority"]
    stop = asyncio.create_task(session.stop_curve({"mode": "curve", "authority": authority, "reason": "drop"}))
    await asyncio.sleep(0)
    assert session.curve_snapshot()["phase"] == "stopping"
    assert session._charge["state"] == "closed"
    adapter.release.set()
    await asyncio.gather(manual, begin, return_exceptions=True)
    await stop
    assert session.curve_snapshot()["phase"] == "terminal"
    assert adapter.writes == [70, 0]


async def test_manual_now_does_not_invent_measurement_and_missing_anchor_is_readonly(fixture):
    session, adapter, now, acquire, start, old, *_ = fixture
    session.close_charge("drop")
    missing = {**old, "session_id": "next", "origin": {"kind": "sample", "sample": {
        "sensor_clock": CLOCK, "acquired_at": 1000.001}}}
    before = session.charge_response()["charge"]
    with pytest.raises(CurveError, match="charge_anchor_missing"):
        session.accept_charge(missing)
    assert session.charge_response()["charge"] == before
    now[0] += 0.5
    accepted, notify = session.accept_charge({**missing, "origin": {"kind": "now"}})
    assert notify and accepted["charge"]["anchor"] is None
    assert accepted["charge"]["acquired_at"] == now[0]
    assert session._filtered is None
    acquire(41)
    assert session._filtered.seed_at == 1041
    assert session._filtered.sample.elapsed_sec == 0.5


async def test_terminal_timeout_late_completion_does_not_claim_success_until_explicit_resolution(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    await session.start_curve(start())
    entered, release = asyncio.Event(), asyncio.Event()
    original = adapter.control
    async def delayed(**kwargs):
        if kwargs.get("heater") == 0:
            entered.set()
            await release.wait()
        await original(**kwargs)
    adapter.control = delayed
    session.barrier_timeout = 0.01
    stop = asyncio.create_task(session.stop(mode="zero"))
    await entered.wait()
    with pytest.raises(ControlUncertain):
        await stop
    assert session.curve_snapshot()["terminal_outcome"] == "uncertain"
    release.set()
    await session.drain()
    assert session.curve_snapshot()["phase"] == "fault"
    assert any(row["event"] == "reconciliation" for row in session.receipts(session._charge["charge_id"])["receipts"])
    await session.stop(mode="zero")
    assert session.curve_snapshot()["phase"] == "terminal"


async def test_target_end_fences_queued_driver_and_renewal_before_watchdog(fixture, expire_curve):
    session, adapter, now, acquire, start, *_ = fixture
    for t in range(41, 59):
        acquire(t)
    begun = await session.start_curve(start())
    authority, ticket = begun["curve"]["authority"], session.ticket
    acquire(59)
    session.renew(authority)
    entered, release = asyncio.Event(), asyncio.Event()
    original = adapter.control
    async def queued(**kwargs):
        if kwargs.get("heater") != 0:
            entered.set()
            await release.wait()
        await original(**kwargs)
    adapter.control = queued
    tick = asyncio.create_task(session.runner.tick())
    await entered.wait()
    now[0] = 1060
    assert not session.current(ticket)
    with pytest.raises(CurveError, match="stale_authority"):
        session.renew(authority)
    release.set()
    await tick
    assert adapter.writes == []
    await expire_curve(session)
    assert adapter.writes == [0]
    assert session.curve_snapshot()["reason"] == "reference_exhausted"


@pytest.mark.parametrize("blocked", ["read", "starting"])
async def test_target_watchdog_revokes_without_waiting_for_io(fixture, blocked):
    session, adapter, now, acquire, start, *_ = fixture
    for t in range(41, 60):
        acquire(t)
    now[0] = 1059.98
    release, entered = asyncio.Event(), asyncio.Event()
    pending = []
    if blocked == "starting":
        adapter.release = release
        pending.append(asyncio.create_task(session.control({"heater": 70})))
        await adapter.entered.wait()
        pending.append(asyncio.create_task(session.start_curve(start())))
        await asyncio.sleep(0)
    else:
        await session.start_curve(start())
        async def read():
            entered.set()
            await release.wait()
            return PvSample(300, now[0], False, True, (CLOCK, now[0]))
        session.runner._read_pv = read
        pending.append(asyncio.create_task(session.runner.tick()))
        await entered.wait()
    ticket = session.ticket
    assert session.curve_snapshot()["lease_deadline"] > 1060
    now[0] = 1060
    async def revoked():
        while session.owns(ticket):
            await asyncio.sleep(0.005)
    try:
        await asyncio.wait_for(revoked(), 0.5)
        assert session.curve_snapshot()["reason"] == "reference_exhausted"
        assert not session.current(ticket)
    finally:
        release.set()
        await asyncio.gather(*pending, return_exceptions=True)
    await asyncio.gather(*session._terminal_tasks)
    assert adapter.writes == ([70, 0] if blocked == "starting" else [0])
    assert session.curve_snapshot()["phase"] == "terminal"


@pytest.mark.parametrize("terminal", ["reset", "disconnected"])
async def test_manager_closes_and_revokes_curve_before_waiting_for_lock(fixture, terminal):
    session, adapter, now, acquire, start, *_ = fixture
    begun = await session.start_curve(start())
    ticket, runner = session.ticket, session.runner
    manager = RoasterManager()
    manager._heat, manager._adapter, manager._protocol = session, adapter, "test"
    await manager._lock.acquire()
    ending = asyncio.create_task(manager.reset_roast() if terminal == "reset" else manager.disconnect())
    try:
        await asyncio.sleep(0)
        assert session._charge["state"] == "closed"
        assert session._charge["closed_reason"] == terminal
        assert not session.owns(ticket)
        assert not session.current(ticket)
        assert session.curve_snapshot()["reason"] == terminal
        with pytest.raises(ControlUnavailable):
            await runner._write_duty(80)
        with pytest.raises(CurveError, match="stale_authority"):
            session.renew(begun["curve"]["authority"])
    finally:
        manager._lock.release()
        await ending
    assert adapter.writes == [0]


async def test_curve_seed_uses_superseded_transmission_after_drain_without_updating_last_applied(fixture):
    session, adapter, now, acquire, start, _, applied = fixture
    await session.control({"heater": 50})
    adapter.release = asyncio.Event()
    manual = asyncio.create_task(session.control({"heater": 90}))
    await adapter.entered.wait()
    begin = asyncio.create_task(session.start_curve(start()))
    await asyncio.sleep(0)
    adapter.release.set()
    with pytest.raises(ControlUnavailable):
        await manual
    await begin
    assert session.runner._last_command == 90
    assert session._last_applied_heat[0] == 50
    assert applied == [{"heater": 50}]
    acquire(41)
    await session.runner.tick()
    assert adapter.writes[:2] == [50, 90]
    assert abs(adapter.writes[-1] - 90) <= 5
    rows = session.receipts(session._charge["charge_id"])["receipts"]
    assert any(row["event"] == "transmitted" and row["acknowledged_heat_set"] == 90 for row in rows)


@pytest.mark.parametrize("observed", [True, False])
async def test_failed_heater_write_invalidates_seed_until_explicit_success(fixture, observed):
    session, adapter, now, acquire, start, *_ = fixture
    await session.control({"heater": 90})
    original = adapter.control
    async def failed(**kwargs):
        if observed:
            adapter.partial_failure = True
            await original(**kwargs)
        else:
            adapter.writes.append(kwargs["heater"])
            raise OSError("transmission outcome unavailable")
    adapter.control = failed
    with pytest.raises(OSError):
        await session.control({"heater": 10, "fan": 20})
    generation = session.ticket.generation
    adapter.control, adapter.partial_failure = original, False
    with pytest.raises(CurveError, match="seed_unavailable"):
        await session.start_curve(start())
    assert session.ticket.generation == generation
    assert session._last_applied_heat[0] == 90
    assert adapter.writes == [90, 10]
    await session.control({"heater": 20})
    await session.start_curve(start())
    assert session.runner._last_command == 20


async def test_drain_rechecks_seed_when_superseded_writer_fails(fixture):
    session, adapter, now, acquire, start, *_ = fixture
    await session.control({"heater": 50})
    adapter.release, adapter.partial_failure = asyncio.Event(), True
    manual = asyncio.create_task(session.control({"heater": 90, "fan": 20}))
    await adapter.entered.wait()
    begin = asyncio.create_task(session.start_curve(start()))
    await asyncio.sleep(0)
    adapter.release.set()
    with pytest.raises(OSError):
        await manual
    with pytest.raises(CurveError, match="seed_unavailable"):
        await begin
    adapter.partial_failure = False
    await asyncio.gather(*session._terminal_tasks)
    assert adapter.writes == [50, 90, 0]
    assert session.curve_snapshot()["reason"] == "start_failed"
    assert session.curve_snapshot()["phase"] == "terminal"


@pytest.mark.parametrize("automatic", [True, False])
async def test_new_charge_waits_for_old_operation_and_writers(fixture, automatic):
    session, adapter, now, acquire, start, request, _ = fixture
    old_charge = session._charge["charge_id"]
    authority = (await session.start_curve(start()))["curve"]["authority"] if automatic else None
    adapter.release = asyncio.Event()
    writer = asyncio.create_task(session.runner._write_duty(70) if automatic else session.control({"heater": 70}))
    await adapter.entered.wait()
    if automatic:
        stop = asyncio.create_task(session.stop_curve({"mode": "curve", "authority": authority, "reason": "drop"}))
        await asyncio.sleep(0)
    else:
        session.close_charge("drop")
    replacement = {**request, "session_id": "next-batch", "expected_generation": session.ticket.generation,
                   "origin": {"kind": "now"}}
    with pytest.raises(CurveError, match="Previous Charge"):
        session.accept_charge(replacement)
    assert session._charge["charge_id"] == old_charge
    adapter.release.set()
    await asyncio.gather(writer, return_exceptions=True)
    if automatic:
        await stop
    rows = session.receipts(old_charge)["receipts"]
    assert all(row["charge_id"] == old_charge and row["session_id"] == request["session_id"] for row in rows)
    if automatic:
        assert [row["purpose"] for row in rows[-3:]] == ["terminal"] * 3
        assert all(row["run_id"] == authority["run_id"] and row["elapsed_sec"] == 40 for row in rows)
    accepted, _ = session.accept_charge({**replacement, "expected_generation": session.ticket.generation})
    assert session.receipts(accepted["charge"]["charge_id"])["receipts"] == []


@pytest.mark.parametrize("reason", ["drop", "workspace_changed"])
async def test_closing_stop_reuses_pending_minimum_but_still_closes_charge(fixture, reason):
    session, adapter, now, acquire, start, *_ = fixture
    authority = (await session.start_curve(start()))["curve"]["authority"]
    entered, release = asyncio.Event(), asyncio.Event()
    original = adapter.control
    async def delayed(**kwargs):
        entered.set()
        await release.wait()
        await original(**kwargs)
    adapter.control = delayed
    user = asyncio.create_task(session.stop_curve({"mode": "curve", "authority": authority, "reason": "user"}))
    await entered.wait()
    terminal_task = session._terminal_task
    closing = asyncio.create_task(session.stop_curve({"mode": "curve", "authority": authority, "reason": reason}))
    await asyncio.sleep(0)
    assert session._charge["state"] == "closed"
    assert session._charge["closed_reason"] == reason
    assert session._terminal_task == terminal_task
    release.set()
    await asyncio.gather(user, closing)
    assert session.curve_snapshot()["reason"] == "user"
    assert adapter.writes == [0]
    with pytest.raises(CurveError, match="charge_closed"):
        await session.start_curve(start())


@pytest.mark.parametrize("reason", ["reference_exhausted", "user"])
async def test_manual_takeover_settles_terminal_obligation_without_rewriting_reason(fixture, reason):
    session, adapter, now, acquire, start, *_ = fixture
    await session.start_curve(start())
    entered, release = asyncio.Event(), asyncio.Event()
    original = adapter.control
    async def delayed(**kwargs):
        if kwargs.get("heater") == 0:
            entered.set()
            await release.wait()
        await original(**kwargs)
    adapter.control = delayed
    ending = asyncio.create_task(session.stop(reason))
    await entered.wait()
    takeover = asyncio.create_task(session.control({"heater": 20}, takeover=True))
    await asyncio.sleep(0)
    assert session.curve_snapshot()["reason"] == reason
    release.set()
    await asyncio.gather(ending, return_exceptions=True)
    assert await takeover == {"heater": 20}
    snapshot = session.curve_snapshot()
    assert snapshot["reason"] == reason
    assert snapshot["phase"] == "terminal"
    assert snapshot["terminal_outcome"] == "completed"
    assert adapter.writes == [20]

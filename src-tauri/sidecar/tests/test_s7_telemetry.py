"""Real Sentry envelopes, fake PLC: diagnostics must cross executor boundaries."""
import asyncio
import logging
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import sentry_sdk
from sentry_sdk.transport import Transport

import config
import sentry_config
from adapters.s7 import S7Adapter
from adapters.s7_diagnostics import S7Diagnostics
from manager import RoasterManager


class MemoryTransport(Transport):
    def __init__(self, options):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.headers.get("type") == "event":
                self.events.append(item.payload.json)


@pytest.fixture
def envelopes(monkeypatch):
    previous = sentry_sdk.get_global_scope().client
    original_init = sentry_sdk.init
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: original_init(**kwargs, transport=MemoryTransport))
    monkeypatch.setattr("slack_notify.notify_hardware_error", lambda **kwargs: None)
    with sentry_sdk.isolation_scope(), sentry_sdk.new_scope():
        sentry_config.init({"SIDECAR_SENTRY_SMOKE": "1", "SIDECAR_VERSION": "1.3.13"})
        client = sentry_sdk.get_client()
        try:
            yield client.transport.events
        finally:
            client.close()
            sentry_sdk.get_global_scope().set_client(previous)


def s7_adapter():
    adapter = S7Adapter(channels=[{"role": "BT", "db": 3, "offset": 116, "type": 1}])
    adapter._bt_ch = adapter._channels[0]
    adapter._min_interval = 0
    plc = MagicMock()
    plc.get_connected.return_value = True
    plc.read_area.side_effect = lambda area, db, offset, size: bytearray(size)
    adapter._plc = plc
    return adapter, plc


async def test_connect_error_is_one_classified_event(envelopes):
    manager = RoasterManager()
    adapter = S7Adapter(channels=[{"role": "BT", "db": 3, "offset": 116, "type": 1}])
    error = TimeoutError("timed out")
    with patch("manager.make_adapter", return_value=adapter), patch(
        "adapters.s7._probe_tcp", side_effect=error
    ):
        await manager.connect("giesen_w45a_w60a", {})
    assert len(envelopes) == 1
    event = envelopes[0]
    assert event["tags"]["event"] == "connect_failed"
    assert event["tags"]["roaster"] == "giesen_w45a_w60a"
    assert event["fingerprint"] == ["hardware", "connect_failed"]
    facts = event["contexts"]["s7_operation"]
    assert facts["stage"] == "tcp_probe"
    assert facts["status"] == "failed"
    assert facts["first_failure"]["error_type"] == "TimeoutError"


async def test_reconnect_errors_do_not_bypass_incident_dedupe(envelopes, monkeypatch):
    manager = RoasterManager()
    manager._roaster_key, manager._protocol = "giesen_w45a_w60a", "s7"
    attempts = 0

    async def connect():
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            raise TimeoutError("timed out")

    manager._adapter = SimpleNamespace(connect=connect, disconnect=AsyncMock(), control=AsyncMock())
    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    await manager._reconnect_loop()
    assert attempts == 3
    assert len(envelopes) == 1
    assert envelopes[0]["tags"]["event"] == "reconnect_failed"
    assert "reconnect_failed" not in manager._hw_alerts_sent


@pytest.mark.parametrize("state,validation,error_code", [
    ("S7CpuStatusStop", "not_run", None),
    (OSError("CPU receive failed"), "error", "receive_failure"),
    (RuntimeError("ISO : error during recv TCP : Connection timed out"), "error", "timeout"),
])
async def test_cpu_validation_outcome_survives_generic_connection_error(envelopes, state, validation, error_code):
    manager = RoasterManager()
    adapter, plc = s7_adapter()
    if isinstance(state, Exception):
        plc.get_cpu_state.side_effect = state
    else:
        plc.get_cpu_state.return_value = state
    with patch("manager.make_adapter", return_value=adapter), patch("adapters.s7._probe_tcp"), patch(
        "snap7.client.Client", return_value=plc
    ):
        await manager.connect("giesen_w45a_w60a", {})
    event = next(e for e in envelopes if e.get("tags", {}).get("event") == "connect_failed")
    facts = event["contexts"]["s7_operation"]
    assert facts["cpu_validation"] == validation
    if error_code is None:
        assert "first_failure" not in facts
    else:
        assert facts["first_failure"]["error_code"] == error_code
    plc.get_cpu_state.assert_called_once()
    plc.disconnect.assert_called_once()
    plc.destroy.assert_called_once()


async def test_read_failure_reaches_parent_capture_without_executor_breadcrumbs(envelopes):
    adapter, plc = s7_adapter()
    error = OSError("read failed 192.0.2.1:102")
    plc.db_read.side_effect = error
    manager = RoasterManager()
    manager._adapter, manager._connected = adapter, True
    manager._roaster_key, manager._protocol = "giesen_w45a_w60a", "s7"
    # Prevent reconnect work; this audit only exercises the actual read/capture path.
    blocker = asyncio.create_task(asyncio.Event().wait())
    manager._reconnect_task = blocker
    try:
        await manager.read_temperatures()
    finally:
        blocker.cancel()
        await asyncio.gather(blocker, return_exceptions=True)
    assert plc.db_read.call_count == 2
    assert len(envelopes) == 1
    facts = envelopes[0]["contexts"]["s7_operation"]
    assert facts["operation"] == "read" and facts["status"] == "failed"
    assert facts["steps"][-1]["attempt"] == 2
    assert facts["first_failure"]["db"] == 3
    assert "192.0.2.1" not in repr(envelopes)


async def test_outer_read_timeout_carries_active_snapshot(envelopes, monkeypatch):
    adapter, plc = s7_adapter()
    started, release, finished = threading.Event(), threading.Event(), threading.Event()

    def read(*args):
        started.set()
        assert release.wait(3)
        finished.set()
        return bytearray.fromhex("42c80000")

    plc.db_read.side_effect = read
    monkeypatch.setattr(config, "READ_TIMEOUT", 0.05)
    manager = RoasterManager()
    manager._adapter, manager._connected = adapter, True
    blocker = asyncio.create_task(asyncio.Event().wait())
    manager._reconnect_task = blocker
    try:
        await manager.read_temperatures()
        assert started.is_set()
        facts = envelopes[0]["contexts"]["s7_operation"]
        assert facts["status"] == "active" and facts["await_cancelled"] is True
        assert facts["active_step"] == {"stage": "read", "db": 3, "offset": 116, "size": 4, "attempt": 1}
        release.set()
        assert await asyncio.to_thread(finished.wait, 2)
        assert facts["status"] == "active"  # Captured snapshot does not mutate after delivery.
    finally:
        release.set()
        blocker.cancel()
        await asyncio.gather(blocker, return_exceptions=True)


@pytest.mark.parametrize("failure_at", [None, 0, 1, 2, 3, 4, 5])
async def test_actuator_sequence_and_delivery_facts(envelopes, failure_at):
    adapter, plc = s7_adapter()
    calls = []
    delivered = []
    error = OSError("delivery failure")

    def io(kind, db, offset, value):
        index = len(calls)
        calls.append((kind, db, offset))
        if index == failure_at:
            raise error
        if kind == "W":
            delivered.append((db, offset, bytes(value)))
        return bytearray(value) if kind == "R" else None

    plc.read_area.side_effect = lambda area, db, offset, size: io("R", db, offset, size)
    plc.write_area.side_effect = lambda area, db, offset, value: io("W", db, offset, value)
    manager = RoasterManager()
    manager._adapter, manager._connected = adapter, True
    manager._roaster_key, manager._protocol = "giesen_w45a_w60a", "s7"
    if failure_at is None:
        result = await manager.door_probe("stirrer_on")
        assert "diagnostics" not in result
    else:
        with pytest.raises(OSError) as caught:
            await manager.door_probe("stirrer_on")
        assert caught.value is error
        manager._capture_hardware_error(error, "door_probe", action="stirrer_on")
    facts = envelopes[-1]["contexts"]["s7_operation"]
    expected = [("R", 2, 30), ("W", 2, 30), ("R", 2, 83), ("W", 2, 83), ("R", 2, 30), ("W", 2, 30)]
    if failure_at is not None and failure_at % 2 == 0:
        expected.pop(failure_at + 1)
    assert calls == expected
    assert facts["completed_writes"] == len(delivered)
    assert facts["final_zero_reached"] == ((2, 30, b"\x00\x00") in delivered)
    if failure_at is not None:
        assert facts["first_failure"]["command_index"] == failure_at // 2 + 1
    assert all(step["elapsed_ms"] >= 0 for step in facts["steps"])


def test_diagnostics_are_bounded_and_cannot_replace_driver_error():
    diagnostics = S7Diagnostics("read")
    for _ in range(30):
        diagnostics.call("read", lambda: None)
    assert len(diagnostics.snapshot()["steps"]) == 16
    error = OSError("original")
    diagnostics._facts = None  # Broken telemetry storage must not break a PLC call.
    assert diagnostics.call("read", lambda: 42) == 42
    with pytest.raises(OSError) as caught:
        diagnostics.execute(lambda: diagnostics.call("read", lambda: (_ for _ in ()).throw(error)))
    assert caught.value is error


async def test_lock_failure_reports_unstarted_command_and_no_zero(envelopes):
    adapter, plc = s7_adapter()
    lock = MagicMock()
    lock.acquire.side_effect = [True, False]
    adapter._io_lock = lock
    with pytest.raises(TimeoutError) as caught:
        await adapter.stirrer_probe(True)
    RoasterManager()._capture_hardware_error(caught.value, "door_probe")
    facts = envelopes[0]["contexts"]["s7_operation"]
    assert facts["completed_writes"] == 1
    assert facts["final_zero_reached"] is False
    assert facts["first_failure"]["stage"] == "lock"
    assert facts["first_failure"]["outcome"] == "not_acquired"
    assert facts["first_failure"]["command_index"] == 2
    assert plc.read_area.call_count == plc.write_area.call_count == 1


async def test_actuator_short_read_retains_first_failure_through_final_zero(envelopes):
    adapter, plc = s7_adapter()
    plc.read_area.side_effect = [bytearray(), bytearray(1), bytearray(2)]
    with pytest.raises(IOError) as caught:
        await adapter.stirrer_probe(True)
    RoasterManager()._capture_hardware_error(caught.value, "door_probe")
    facts = envelopes[0]["contexts"]["s7_operation"]
    assert facts["first_failure"] == {
        "stage": "read_validation", "command_index": 1, "db": 2, "offset": 30,
        "error_type": "OSError", "error_code": "short_read",
    }
    assert facts["completed_writes"] == 2 and facts["final_zero_reached"] is True
    assert [(c[0], c.args[1:3]) for c in plc.mock_calls] == [
        ("read_area", (2, 30)), ("read_area", (2, 83)), ("write_area", (2, 83)),
        ("read_area", (2, 30)), ("write_area", (2, 30)),
    ]


@pytest.mark.parametrize("failure", [False, True])
async def test_explicit_actuator_read_keeps_read_only_traffic_and_diagnostics(envelopes, failure):
    adapter, plc = s7_adapter()
    error = OSError("read failed")
    plc.db_read.side_effect = [bytearray(2), error] if failure else [bytearray(2), bytearray(1)] * 2
    manager = RoasterManager()
    manager._adapter, manager._connected = adapter, True
    manager._roaster_key, manager._protocol = "giesen_w45a_w60a", "s7"
    if failure:
        with pytest.raises(OSError) as caught:
            await manager.door_probe("read")
        assert caught.value is error
        manager._capture_hardware_error(error, "door_probe", action="read")
    else:
        result = await manager.door_probe("read")
        assert "diagnostics" not in result
    facts = envelopes[-1]["contexts"]["s7_operation"]
    assert facts["operation"] == "actuator_read"
    assert facts["completed_writes"] == 0
    expected_reads = [(2, 30, 2), (2, 82, 1)] * (1 if failure else 2)
    assert [(c[0], c.args) for c in plc.mock_calls] == [("db_read", args) for args in expected_reads]
    if failure:
        assert facts["first_failure"]["stage"] == "read"
        assert facts["first_failure"]["offset"] == 82
        assert facts["first_failure"]["phase"] == "before"


@pytest.mark.parametrize("message,code", [
    ("TCP timeout", "timeout"),
    ("connection reset by peer", "connection_reset"),
    ("TCP connection refused", "connection_refused"),
    ("CPU : Address out of range", "address_range"),
    ("CPU : Function refused", "function_refused"),
    ("ISO : An error occurred during recv", "receive_failure"),
    ("ISO : An error occurred during send", "send_failure"),
    ("unexpected device response", "unknown"),
])
def test_error_codes_are_fixed_without_raw_messages(message, code):
    diagnostics = S7Diagnostics("connect")
    error = RuntimeError(message)

    def fail():
        raise error

    with pytest.raises(RuntimeError):
        diagnostics.call("cpu_state", fail)
    facts = diagnostics.snapshot()
    assert facts["first_failure"]["error_code"] == code
    assert message not in repr(facts)


def test_error_classification_cannot_mask_an_exception_with_broken_str():
    class BrokenError(Exception):
        def __str__(self):
            raise ValueError("broken annotation")

    error = BrokenError()
    diagnostics = S7Diagnostics("connect")

    def fail():
        raise error

    with pytest.raises(BrokenError) as caught:
        diagnostics.call("cpu_state", fail)
    assert caught.value is error
    assert diagnostics.snapshot()["first_failure"]["error_code"] == "unknown"


@pytest.mark.parametrize("channel_type,value_offset,requested,expected_hex,observed_hex", [
    (0, 1, 50, "0033", "0032"),
    (0, 1, 0, "0001", "0000"),
    (0, 1, 0, "0001", ""),
    (0, 1, 0, "0001", "01"),
    (1, 0, 12.5, "41480000", "41400000"),
])
async def test_control_readback_failure_keeps_original_delivery_sequence(
    envelopes, channel_type, value_offset, requested, expected_hex, observed_hex,
):
    adapter, plc = s7_adapter()
    adapter._write_map = {"heater": {
        "db": 2, "offset": 14, "type": channel_type,
        "value_offset": value_offset, "verify_readback": True,
    }}
    expected_payload = bytearray.fromhex(expected_hex)
    plc.db_read.return_value = bytearray.fromhex(observed_hex)
    with pytest.raises(IOError) as caught:
        await adapter.control(heater=requested)
    RoasterManager()._capture_hardware_error(caught.value, "control_write_failed")
    assert len(envelopes) == 1
    facts = envelopes[0]["contexts"]["s7_operation"]
    assert facts["completed_writes"] == 1 and facts["readback_matched"] is False
    assert facts["stage"] == "readback"
    assert facts["readback_role"] == "heater"
    assert (facts["readback_db"], facts["readback_offset"]) == (2, 14)
    assert facts["readback_expected_hex"] == expected_hex
    assert facts["readback_observed_hex"] == observed_hex
    assert [(c[0], c.args) for c in plc.mock_calls] == [
        ("db_write", (2, 14, expected_payload)),
        ("db_read", (2, 14, len(expected_payload))),
    ]


async def test_concurrent_failures_keep_their_own_operation_facts():
    started, release = threading.Event(), threading.Event()
    read_error, write_error = OSError("read"), OSError("write")
    read, write = S7Diagnostics("read"), S7Diagnostics("control")

    def blocked():
        started.set()
        assert release.wait(2)
        raise read_error

    pending = asyncio.create_task(read.run(lambda: read.call("read", blocked)))
    try:
        assert await asyncio.to_thread(started.wait, 1)
        with pytest.raises(OSError):
            await write.run(lambda: write.call("write", lambda: (_ for _ in ()).throw(write_error)))
    finally:
        release.set()
    with pytest.raises(OSError):
        await pending
    assert read_error.s7_diagnostics["operation"] == "read"
    assert write_error.s7_diagnostics["operation"] == "control"
    assert read_error.s7_diagnostics["first_failure"]["stage"] == "read"
    assert write_error.s7_diagnostics["first_failure"]["stage"] == "write"


def test_logentry_and_nested_diagnostics_are_scrubbed(envelopes):
    logging.getLogger("audit").error("failed host=%s token=%s", "192.0.2.1", "synthetic-secret")
    event = envelopes[-1]
    assert "params" not in event["logentry"]
    assert "synthetic-secret" not in repr(event)
    assert "192.0.2.1" not in repr(event)
    sample = {"contexts": {"s7_operation": {"steps": [{"error": "connect [2001:db8::1]:102 token=synthetic-secret", "elapsed_ms": 150}]}}}
    clean = sentry_config.before_send(sample, {})
    assert "2001:db8" not in repr(clean)
    assert "synthetic-secret" not in repr(clean)
    assert clean["contexts"]["s7_operation"]["steps"][0]["elapsed_ms"] == 150

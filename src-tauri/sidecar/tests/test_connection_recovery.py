"""A restored socket is not a recovered temperature stream."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import config
import pytest
from manager import SensorReadError
from tests.conftest import FakeAdapter, make_reading


@pytest.fixture
def scope():
    with patch("manager.sentry_sdk.new_scope") as new_scope, patch("slack_notify.notify_hardware_error"):
        scope = MagicMock()
        new_scope.return_value.__enter__.return_value = scope
        yield scope


def connected(manager, adapter):
    manager._adapter, manager._connected = adapter, True
    manager._protocol, manager._roaster_key = "s7", "giesen_w1"


async def test_recovery_waits_for_valid_fresh_read_and_emits_once(manager, monkeypatch, scope):
    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    adapter = FakeAdapter([make_reading(bt=0), make_reading(), make_reading()])
    connected(manager, adapter)
    await manager.read_temperatures()
    initial = manager._connection_incident
    assert initial is not None
    await manager._reconnect_task
    scope.capture_message.assert_not_called()
    assert initial.reconnect_attempts == 1
    assert initial.transport_restored_at is not None
    await manager.read_temperatures()
    scope.capture_message.assert_called_once_with("Hardware readings recovered", level="info")
    facts = [args[0][1] for args in scope.set_context.call_args_list if args[0][0] == "connection_incident"][-1]
    assert facts["incident_id"] == initial.incident_id
    assert facts["initial_reason"] == "invalid_bt"
    assert facts["duration_ms"] >= facts["transport_restored_ms"] >= 0
    assert facts["reconnect_attempts"] == 1
    assert facts["fresh_read_validated"] is True
    assert manager._connection_incident is None
    assert not manager._connection_failures_sent
    await manager.read_temperatures()
    scope.capture_message.assert_called_once()


async def test_reconnect_handshake_invalid_reads_share_one_incident(manager, monkeypatch, scope):
    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    adapter = FakeAdapter([make_reading(bt=0), make_reading(bt=0), make_reading()])
    connected(manager, adapter)
    await manager.read_temperatures()
    incident = manager._connection_incident
    await manager._reconnect_task
    await manager.read_temperatures()
    await manager._reconnect_task
    assert manager._connection_incident is incident
    assert incident.reconnect_attempts == 2
    scope.capture_message.assert_not_called()
    assert scope.capture_exception.call_count == 1
    await manager.read_temperatures()
    scope.capture_message.assert_called_once()


async def test_changed_reconnect_cause_is_captured_once_per_group(manager, scope):
    manager._protocol = "s7"
    for _ in range(2):
        for stage in ("tcp_probe", "connect"):
            exc = TimeoutError()
            exc.s7_diagnostics = {"stage": stage}
            manager._capture_hardware_error(exc, "reconnect_failed", once=True)
    assert scope.capture_exception.call_count == 2


async def test_new_incident_can_report_the_same_failure_again(manager, scope):
    connected(manager, FakeAdapter([make_reading()]))
    error = SensorReadError("BT 0")
    manager._begin_connection_incident(error, "first_read_failed")
    old_id = manager._connection_incident.incident_id
    manager._capture_hardware_error(error, "first_read_failed", once=True)
    await manager.read_temperatures()
    manager._begin_connection_incident(error, "first_read_failed")
    assert manager._connection_incident.incident_id != old_id
    manager._capture_hardware_error(error, "first_read_failed", once=True)
    assert scope.capture_exception.call_count == 2


async def test_manual_disconnect_and_new_connection_cannot_report_old_recovery(manager, scope):
    connected(manager, FakeAdapter([make_reading()]))
    manager._begin_connection_incident(TimeoutError(), "read_failed_disconnected")
    await manager.disconnect()
    assert manager._connection_incident is None
    connected(manager, FakeAdapter([make_reading()]))
    await manager.read_temperatures()
    scope.capture_message.assert_not_called()


async def test_transient_stale_recovery_does_not_emit_an_issue(manager, scope):
    adapter = FakeAdapter()
    adapter.read = AsyncMock(side_effect=[make_reading(), TimeoutError(), make_reading()])
    connected(manager, adapter)
    await manager.read_temperatures()
    assert (await manager.read_temperatures())["stale"] is True
    await manager.read_temperatures()
    scope.capture_message.assert_not_called()
    scope.capture_exception.assert_not_called()


async def test_cached_read_does_not_mark_recovery(manager, scope):
    connected(manager, FakeAdapter([make_reading()]))
    await manager.read_temperatures()
    manager._begin_connection_incident(TimeoutError(), "read_failed_disconnected")
    await manager.read_temperatures(max_age=100)
    scope.capture_message.assert_not_called()


@pytest.mark.parametrize("failure", [False, True])
async def test_previous_epoch_read_does_not_finish_or_change_incident(manager, scope, failure):
    started, release = asyncio.Event(), asyncio.Event()
    async def read():
        started.set()
        await release.wait()
        if failure:
            raise TimeoutError()
        return make_reading()
    adapter = FakeAdapter()
    adapter.read = read
    connected(manager, adapter)
    task = asyncio.create_task(manager.read_temperatures())
    await started.wait()
    manager._connection_epoch += 1
    manager._begin_connection_incident(TimeoutError(), "read_failed_disconnected")
    release.set()
    assert (await task)["bt"] is None
    scope.capture_message.assert_not_called()
    scope.capture_exception.assert_not_called()
    assert manager._consecutive_errors == 0


async def test_recovery_telemetry_failure_does_not_break_reading(manager, scope):
    connected(manager, FakeAdapter([make_reading()]))
    manager._begin_connection_incident(TimeoutError(), "read_failed_disconnected")
    scope.capture_message.side_effect = RuntimeError("telemetry unavailable")
    assert (await manager.read_temperatures())["bt"] == 150
    assert manager._connection_incident is None


async def test_failed_attempt_counts_survive_handshake_until_valid_read(manager, monkeypatch, scope):
    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    adapter = FakeAdapter([make_reading(bt=0), make_reading()])
    adapter.connect = AsyncMock(side_effect=[TimeoutError(), ConnectionRefusedError(), None])
    connected(manager, adapter)
    await manager.read_temperatures()
    await manager._reconnect_task
    incident = manager._connection_incident
    assert incident.reconnect_attempts == 3
    assert incident.reconnect_failures == 2
    assert scope.capture_exception.call_count == 3
    scope.capture_message.assert_not_called()
    await manager.read_temperatures()
    scope.capture_message.assert_called_once()


async def test_cancel_in_flight_reconnect_clears_incident_without_recovery(manager, monkeypatch, scope):
    monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0])
    adapter = FakeAdapter([make_reading(bt=0)], connect_gate=asyncio.Event())
    connected(manager, adapter)
    await manager.read_temperatures()
    await asyncio.wait_for(adapter.connect_started.wait(), timeout=1)
    await asyncio.wait_for(manager.disconnect(), timeout=1)
    assert manager._connection_incident is None
    assert not manager._connection_failures_sent
    scope.capture_message.assert_not_called()

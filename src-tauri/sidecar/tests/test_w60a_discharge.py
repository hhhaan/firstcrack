"""W60A discharge writes are fixed, opt-in and bound to one connection."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer
from snap7.util.getters import get_int

from adapters.s7 import S7Adapter
from control_guard import ControlUnavailable
from main import create_app
from protocol_trace import TRACE
from roaster_registry import ROASTER_REGISTRY
from tests.conftest import make_reading


@pytest.mark.parametrize("action,raw", [("open", 5), ("close", 6)])
async def test_writes_only_discharge_command_word(action, raw):
    adapter = S7Adapter(w60a_discharge="on")
    adapter._plc = MagicMock()
    adapter._min_interval = 0
    await adapter.discharge(action)
    adapter._plc.db_write.assert_called_once()
    db, offset, payload = adapter._plc.db_write.call_args.args
    assert (db, offset, get_int(payload, 0)) == (2, 30, raw)
    assert len(payload) == 2  # No pulse-to-zero or cooling tray RELEASE.


@pytest.mark.parametrize("door,action,raw", [
    ("fill", "open", 1), ("fill", "close", 2),
    ("discharge", "open", 5), ("discharge", "close", 6),
])
async def test_door_trace_distinguishes_acknowledgement_from_transmission(door, action, raw):
    adapter = S7Adapter(w60a_discharge="on", w60a_fill="on")
    adapter._plc = MagicMock()
    adapter._min_interval = 0
    TRACE.enabled = True
    await getattr(adapter, door)(action)
    entries = TRACE.dump()
    assert entries[-1]["dir"] == "rx"
    assert entries[-1]["detail"] == f"db_write acknowledged db=2 offset=30 role={door}"
    assert entries[-1]["data"] == raw
    adapter._plc.db_write.assert_called_once()
    adapter._plc.db_read.assert_not_called()


@pytest.mark.parametrize("raw", [0, 1, 2, 5, 6, 42])
async def test_door_command_read_preserves_raw_value_without_writing(raw):
    adapter = S7Adapter()
    adapter._plc = MagicMock()
    adapter._plc.db_read.return_value = bytearray(raw.to_bytes(2, "big", signed=True))
    adapter._min_interval = 0
    assert await adapter.read_door_command() == raw
    adapter._plc.db_read.assert_called_once_with(2, 30, 2)
    adapter._plc.db_write.assert_not_called()


@pytest.mark.parametrize("changed", ["client", "session"])
async def test_door_command_read_rejects_connection_changed_while_waiting_for_lock(changed):
    adapter = S7Adapter()
    old_plc = MagicMock()
    adapter._plc = old_plc

    def acquire(**_):
        if changed == "client":
            adapter._plc = MagicMock()
        else:
            adapter._session += 1
        return True

    adapter._io_lock = MagicMock()
    adapter._io_lock.acquire.side_effect = acquire
    with pytest.raises(ConnectionError):
        await adapter.read_door_command()
    old_plc.db_read.assert_not_called()
    old_plc.db_write.assert_not_called()
    adapter._io_lock.release.assert_called_once()


async def test_door_command_read_discards_result_after_session_changes():
    adapter = S7Adapter()
    plc = MagicMock()
    adapter._plc = plc
    adapter._min_interval = 0

    def read(*_):
        adapter._session += 1
        return bytearray(b"\x00\x05")

    plc.db_read.side_effect = read
    with pytest.raises(ConnectionError):
        await adapter.read_door_command()
    plc.db_write.assert_not_called()
    assert adapter._io_lock.locked() is False


async def test_failed_door_write_does_not_record_an_acknowledgement():
    adapter = S7Adapter(w60a_discharge="on")
    adapter._plc = MagicMock()
    adapter._plc.db_write.side_effect = ConnectionError("PLC write failed")
    adapter._min_interval = 0
    TRACE.enabled = True
    with pytest.raises(ConnectionError):
        await adapter.discharge("open")
    assert [entry["dir"] for entry in TRACE.dump()] == ["tx"]
    adapter._plc.db_write.assert_called_once()


@pytest.mark.parametrize("enabled,action", [("off", "open"), ("on", "release")])
async def test_adapter_rejects_disabled_or_other_actions(enabled, action):
    adapter = S7Adapter(w60a_discharge=enabled)
    adapter._plc = MagicMock()
    with pytest.raises(ValueError):
        await adapter.discharge(action)
    adapter._plc.db_write.assert_not_called()


@pytest.mark.parametrize("changed", ["client", "session"])
async def test_adapter_rejects_connection_changed_while_waiting_for_lock(changed):
    adapter = S7Adapter(w60a_discharge="on")
    old_plc, new_plc = MagicMock(), MagicMock()
    adapter._plc = old_plc

    def acquire(**_):
        if changed == "client":
            adapter._plc = new_plc
        else:
            adapter._session += 1
        return True

    adapter._io_lock = MagicMock()
    adapter._io_lock.acquire.side_effect = acquire
    with pytest.raises(ConnectionError):
        await adapter.discharge("open")
    old_plc.db_write.assert_not_called()
    new_plc.db_write.assert_not_called()
    adapter._io_lock.release.assert_called_once()


def enable_discharge(manager):
    manager._roaster_key = "giesen_w45a_w60a"
    manager._machine_id = "door-test"
    manager._protocol = "s7"
    manager._w60a_discharge_enabled = True
    manager._connected = True
    manager._adapter = AsyncMock()


@pytest.mark.parametrize("block", ["disabled", "other_model", "disconnected", "resetting"])
async def test_manager_rejects_unavailable_discharge(manager, block):
    enable_discharge(manager)
    adapter = manager._adapter
    if block == "disabled":
        manager._w60a_discharge_enabled = False
    elif block == "other_model":
        manager._roaster_key = "giesen_w6a_pro"  # gitleaks:allow
    elif block == "disconnected":
        manager._connected = False
    else:
        manager._resetting = True
    with pytest.raises(ControlUnavailable):
        await manager.discharge("open", {"machine_id": manager._machine_id, "connection_epoch": manager._connection_epoch})
    adapter.discharge.assert_not_awaited()


async def test_reconnecting_manager_rejects_discharge_even_when_the_switch_is_on(manager):
    enable_discharge(manager)
    manager._reconnect_task = MagicMock()
    manager._reconnect_task.done.return_value = False
    with pytest.raises(ControlUnavailable):
        await manager.discharge("open", {"machine_id": manager._machine_id, "connection_epoch": manager._connection_epoch})
    manager._adapter.discharge.assert_not_awaited()


async def test_manager_rejects_late_acknowledgement(manager):
    enable_discharge(manager)

    async def changed(_):
        manager._connection_epoch += 1

    manager._adapter.discharge.side_effect = changed
    scope = MagicMock()
    with (
        pytest.raises(ControlUnavailable),
        patch("manager.sentry_sdk.new_scope") as new_scope,
    ):
        new_scope.return_value.__enter__.return_value = scope
        await manager.discharge("open", {"machine_id": manager._machine_id, "connection_epoch": manager._connection_epoch})
    scope.capture_exception.assert_called_once()
    assert scope.fingerprint == ["door_write_ambiguous", "discharge", "open"]
    assert "10.0.0.2" not in str(scope.capture_exception.call_args)
    tag_args = [call.args for call in scope.set_tag.call_args_list]
    assert ("door", "discharge") in tag_args
    assert ("action", "open") in tag_args
    assert ("event", "door_write_ambiguous") in tag_args


async def test_batch_reset_preserves_s7_connection_without_moving_door(manager):
    enable_discharge(manager)
    adapter, epoch = manager._adapter, manager._connection_epoch
    await manager.reset_roast()
    adapter.discharge.assert_not_awaited()
    assert manager._adapter is adapter and manager._connection_epoch == epoch
    await manager.discharge("open", {"machine_id": manager._machine_id, "connection_epoch": manager._connection_epoch})
    adapter.discharge.assert_awaited_once_with("open")


@pytest.fixture
async def discharge_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_w60a_probe_exposes_command_word_without_moving_doors(discharge_client):
    manager = discharge_client.server.app["manager"]
    enable_discharge(manager)
    adapter = S7Adapter()
    adapter._plc = MagicMock()
    adapter._plc.db_read.return_value = bytearray(b"\x00\x05")
    adapter._min_interval = 0
    manager._adapter = adapter
    body = await (await discharge_client.get("/debug/probe")).json()
    assert body["ok"] is True
    assert body["door_command"] == {"db": 2, "offset": 30, "raw": 5}
    adapter._plc.db_read.assert_called_once_with(2, 30, 2)
    adapter._plc.db_write.assert_not_called()
    assert any(entry["detail"] == "db_read db=2 offset=30 role=door_command" for entry in body["trace"])


async def test_door_probe_failure_preserves_temperature_result_and_reports_once(discharge_client):
    manager = discharge_client.server.app["manager"]
    enable_discharge(manager)
    manager._adapter.read.return_value = make_reading()
    error = ConnectionError("PLC command word read failed")
    manager._adapter.read_door_command.side_effect = error
    manager._capture_hardware_error = MagicMock()
    body = await (await discharge_client.get("/debug/probe")).json()
    assert body["ok"] is True
    assert body["door_command"] == {"db": 2, "offset": 30, "error": "read_failed"}
    manager._capture_hardware_error.assert_called_once_with(error, "door_command_probe_failed", once=True)
    manager._adapter.discharge.assert_not_awaited()
    manager._adapter.fill.assert_not_awaited()


async def test_other_roaster_probe_does_not_read_w60a_command_word(discharge_client):
    manager = discharge_client.server.app["manager"]
    enable_discharge(manager)
    manager._adapter.read.return_value = make_reading()
    manager._roaster_key = "giesen_standard"
    body = await (await discharge_client.get("/debug/probe")).json()
    assert "door_command" not in body
    manager._adapter.read_door_command.assert_not_awaited()


async def test_machine_catalog_does_not_put_discharge_on_the_connection_form(discharge_client):
    response = await discharge_client.get("/roasters")
    catalog = await response.json()
    assert "w60a_discharge" not in catalog["giesen_w45a_w60a"]["default_params"]
    keys = {key for key, definition in catalog.items()
            if any(field["key"] == "w60a_discharge" for field in definition["form_fields"])}
    assert keys == set()


@pytest.mark.parametrize("body", [[], None, {"action": "release"}, {"action": "open", "db": 3}])
async def test_endpoint_rejects_invalid_payload(discharge_client, body):
    response = await discharge_client.post("/discharge", json=body)
    assert response.status == 400


async def test_endpoint_unavailable_success_and_write_failure(discharge_client):
    response = await discharge_client.post("/discharge", json={"action": "open"})
    assert response.status == 409
    manager = discharge_client.server.app["manager"]
    enable_discharge(manager)
    response = await discharge_client.post("/discharge", json={"action": "close", "machine_id": "door-test", "connection_epoch": 0})
    assert response.status == 200
    assert await response.json() == {"ok": True}
    manager._adapter.discharge.assert_awaited_once_with("close")
    manager._adapter.discharge.side_effect = ConnectionError("PLC 10.0.0.2 write failed")
    scope = MagicMock()
    with patch("manager.sentry_sdk.new_scope") as new_scope:
        new_scope.return_value.__enter__.return_value = scope
        response = await discharge_client.post("/discharge", json={"action": "open", "machine_id": "door-test", "connection_epoch": 0})
    assert response.status == 502
    scope.capture_exception.assert_called_once()
    assert scope.fingerprint == ["hardware", "discharge", "discharge"]
    tag_args = [call.args for call in scope.set_tag.call_args_list]
    assert ("event", "discharge") in tag_args
    assert ("door", "discharge") in tag_args
    assert ("action", "open") in tag_args
    assert "10.0.0.2" not in str(scope.capture_exception.call_args)


def test_discharge_is_not_a_connection_setting():
    definition = ROASTER_REGISTRY["giesen_w45a_w60a"]
    assert "w60a_discharge" not in definition["default_params"]
    assert all(field["key"] != "w60a_discharge" for field in definition.get("form_fields", []))

"""W60A discharge writes are fixed, opt-in and bound to one connection."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from snap7.util.getters import get_int

from adapters.s7 import S7Adapter
from control_guard import ControlUnavailable
from main import create_app
from roaster_registry import ROASTER_REGISTRY


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
    manager._protocol = "s7"
    manager._merged_params = {"w60a_discharge": "on"}
    manager._connected = True
    manager._adapter = AsyncMock()


@pytest.mark.parametrize("block", ["disabled", "other_model", "disconnected", "resetting"])
async def test_manager_rejects_unavailable_discharge(manager, block):
    enable_discharge(manager)
    adapter = manager._adapter
    if block == "disabled":
        manager._merged_params = {}
    elif block == "other_model":
        manager._roaster_key = "giesen_w6a_pro"
    elif block == "disconnected":
        manager._connected = False
    else:
        manager._resetting = True
    with pytest.raises(ControlUnavailable):
        await manager.discharge("open")
    adapter.discharge.assert_not_awaited()


async def test_manager_rejects_late_acknowledgement(manager):
    enable_discharge(manager)

    async def changed(_):
        manager._connection_epoch += 1

    manager._adapter.discharge.side_effect = changed
    with pytest.raises(ControlUnavailable):
        await manager.discharge("open")


async def test_batch_reset_preserves_s7_connection_without_moving_door(manager):
    enable_discharge(manager)
    adapter, epoch = manager._adapter, manager._connection_epoch
    await manager.reset_roast()
    adapter.discharge.assert_not_awaited()
    assert manager._adapter is adapter and manager._connection_epoch == epoch
    await manager.discharge("open")
    adapter.discharge.assert_awaited_once_with("open")


@pytest.fixture
async def discharge_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_machine_catalog_exposes_discharge_setting_only_on_w60_preset(discharge_client):
    response = await discharge_client.get("/roasters")
    catalog = await response.json()
    assert catalog["giesen_w45a_w60a"]["default_params"]["w60a_discharge"] == "off"
    keys = {key for key, definition in catalog.items()
            if any(field["key"] == "w60a_discharge" for field in definition["form_fields"])}
    assert keys == {"giesen_w45a_w60a"}


@pytest.mark.parametrize("body", [[], None, {"action": "release"}, {"action": "open", "db": 3}])
async def test_endpoint_rejects_invalid_payload(discharge_client, body):
    response = await discharge_client.post("/discharge", json=body)
    assert response.status == 400


async def test_endpoint_unavailable_success_and_write_failure(discharge_client):
    response = await discharge_client.post("/discharge", json={"action": "open"})
    assert response.status == 409
    manager = discharge_client.server.app["manager"]
    enable_discharge(manager)
    response = await discharge_client.post("/discharge", json={"action": "close"})
    assert response.status == 200
    assert await response.json() == {"ok": True}
    manager._adapter.discharge.assert_awaited_once_with("close")
    manager._adapter.discharge.side_effect = ConnectionError("PLC write failed")
    response = await discharge_client.post("/discharge", json={"action": "open"})
    assert response.status == 502


def test_discharge_is_disabled_in_default_machine_settings():
    definition = ROASTER_REGISTRY["giesen_w45a_w60a"]
    assert definition["default_params"]["w60a_discharge"] == "off"
    assert any(field["key"] == "w60a_discharge" for field in definition["form_fields"])

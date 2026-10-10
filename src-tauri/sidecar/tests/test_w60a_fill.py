"""W60A fill writes latch DB2.30 to 1/2 and stay opt-in."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from snap7.util.getters import get_int

from adapters.s7 import S7Adapter
from control_guard import ControlUnavailable
from main import create_app
from roaster_registry import ROASTER_REGISTRY


@pytest.mark.parametrize("action,raw", [("open", 1), ("close", 2)])
async def test_writes_only_fill_command_word(action, raw):
    adapter = S7Adapter(w60a_fill="on")
    adapter._plc = MagicMock()
    adapter._min_interval = 0
    await adapter.fill(action)
    adapter._plc.db_write.assert_called_once()
    db, offset, payload = adapter._plc.db_write.call_args.args
    assert (db, offset, get_int(payload, 0)) == (2, 30, raw)
    assert len(payload) == 2


@pytest.mark.parametrize("enabled,action", [("off", "open"), ("on", "release")])
async def test_adapter_rejects_disabled_or_other_actions(enabled, action):
    adapter = S7Adapter(w60a_fill=enabled)
    adapter._plc = MagicMock()
    with pytest.raises(ValueError):
        await adapter.fill(action)
    adapter._plc.db_write.assert_not_called()


def enable_fill(manager):
    manager._roaster_key = "giesen_w45a_w60a"
    manager._protocol = "s7"
    manager._w60a_fill_enabled = True
    manager._connected = True
    manager._adapter = AsyncMock()


@pytest.mark.parametrize("block", ["disabled", "other_model", "disconnected", "resetting"])
async def test_manager_rejects_unavailable_fill(manager, block):
    enable_fill(manager)
    adapter = manager._adapter
    if block == "disabled":
        manager._w60a_fill_enabled = False
    elif block == "other_model":
        manager._roaster_key = "giesen_w6a_pro"  # gitleaks:allow
    elif block == "disconnected":
        manager._connected = False
    else:
        manager._resetting = True
    with pytest.raises(ControlUnavailable):
        await manager.fill("open")
    adapter.fill.assert_not_awaited()


async def test_settings_enable_fill_without_a_connection_field(manager):
    manager._roaster_key = "giesen_w45a_w60a"
    manager._protocol = "s7"
    manager._connected = True
    manager._adapter = MagicMock()
    assert manager.fill_enabled() is False
    manager.update_settings({"w60a_fill": True, "w60a_discharge": False})
    assert manager.fill_enabled() is True
    assert manager.discharge_enabled() is False
    manager._adapter.set_w60a_doors.assert_called_once_with(discharge=False, fill=True)


async def test_fill_open_does_not_send_discharge_code(manager):
    enable_fill(manager)
    manager._w60a_discharge_enabled = True
    await manager.fill("open")
    manager._adapter.fill.assert_awaited_once_with("open")
    manager._adapter.discharge.assert_not_awaited()


@pytest.fixture
async def fill_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_machine_catalog_does_not_put_fill_on_the_connection_form(fill_client):
    response = await fill_client.get("/roasters")
    catalog = await response.json()
    assert "w60a_fill" not in catalog["giesen_w45a_w60a"]["default_params"]
    keys = {
        key
        for key, definition in catalog.items()
        if any(field["key"] == "w60a_fill" for field in definition["form_fields"])
    }
    assert keys == set()


@pytest.mark.parametrize("body", [[], None, {"action": "release"}, {"action": "open", "db": 3}])
async def test_endpoint_rejects_invalid_payload(fill_client, body):
    response = await fill_client.post("/fill", json=body)
    assert response.status == 400


async def test_endpoint_unavailable_success_and_write_failure(fill_client):
    response = await fill_client.post("/fill", json={"action": "open"})
    assert response.status == 409
    manager = fill_client.server.app["manager"]
    enable_fill(manager)
    response = await fill_client.post("/fill", json={"action": "close"})
    assert response.status == 200
    assert await response.json() == {"ok": True}
    manager._adapter.fill.assert_awaited_once_with("close")
    manager._adapter.fill.side_effect = ConnectionError("PLC write failed")
    response = await fill_client.post("/fill", json={"action": "open"})
    assert response.status == 502


def test_fill_is_not_a_connection_setting():
    definition = ROASTER_REGISTRY["giesen_w45a_w60a"]
    assert "w60a_fill" not in definition["default_params"]
    assert all(field["key"] != "w60a_fill" for field in definition.get("form_fields", []))

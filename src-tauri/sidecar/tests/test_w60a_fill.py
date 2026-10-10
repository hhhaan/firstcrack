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
    manager._merged_params = {"w60a_fill": "on"}
    manager._connected = True
    manager._adapter = AsyncMock()


@pytest.mark.parametrize("block", ["disabled", "other_model", "disconnected", "resetting"])
async def test_manager_rejects_unavailable_fill(manager, block):
    enable_fill(manager)
    adapter = manager._adapter
    if block == "disabled":
        manager._merged_params = {}
    elif block == "other_model":
        manager._roaster_key = "giesen_w6a_pro"  # gitleaks:allow
    elif block == "disconnected":
        manager._connected = False
    else:
        manager._resetting = True
    with pytest.raises(ControlUnavailable):
        await manager.fill("open")
    adapter.fill.assert_not_awaited()


async def test_fill_open_does_not_send_discharge_code(manager):
    enable_fill(manager)
    manager._merged_params["w60a_discharge"] = "on"
    await manager.fill("open")
    manager._adapter.fill.assert_awaited_once_with("open")
    manager._adapter.discharge.assert_not_awaited()


@pytest.fixture
async def fill_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_machine_catalog_exposes_fill_setting_only_on_w60_preset(fill_client):
    response = await fill_client.get("/roasters")
    catalog = await response.json()
    assert catalog["giesen_w45a_w60a"]["default_params"]["w60a_fill"] == "off"
    keys = {
        key
        for key, definition in catalog.items()
        if any(field["key"] == "w60a_fill" for field in definition["form_fields"])
    }
    assert keys == {"giesen_w45a_w60a"}


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


def test_fill_is_disabled_in_default_machine_settings():
    definition = ROASTER_REGISTRY["giesen_w45a_w60a"]
    assert definition["default_params"]["w60a_fill"] == "off"
    assert any(field["key"] == "w60a_fill" for field in definition["form_fields"])

from unittest.mock import patch

import pytest

from adapters.base import Reading
from manager import RoasterManager
from tests.conftest import FakeAdapter


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["s7", "modbus"])
async def test_imported_feedback_preserves_units_precision_without_granting_control(protocol):
    channels = [
        {"role": role, "db": 2, "offset": offset, "register": offset, "unit": unit}
        for role, offset, unit in [("heater", 48, "%"), ("fan", 52, "Pa"), ("drum", 18, "Hz")]
    ]
    params = ({"channels": channels} if protocol == "s7" else
              {"modbus_registers": {channel["role"]: channel for channel in channels}})
    manager = RoasterManager()
    reading = Reading(bt=190, et=210, heater=42.25, fan=1234.56, drum=31.25, timestamp=10)
    with patch("manager.make_adapter", return_value=FakeAdapter(readings=[reading])):
        await manager.connect(f"custom_{protocol}", params)
    status = manager.status()
    assert status["capabilities"] == ["heater", "fan", "drum"]
    assert status["read_units"] == {"heater": "%", "fan": "Pa", "drum": "Hz"}
    assert status["control"]["writable"] is False
    assert status["control"]["limits"] == {}
    result = await manager.read_temperatures()
    assert (result["heater"], result["fan"], result["drum"]) == (42.25, 1234.56, 31.25)
    assert result["processing"]["read_units"] == status["read_units"]
    await manager.disconnect()


def test_write_map_does_not_create_read_channels_or_units():
    manager = RoasterManager()
    manager._protocol = "s7"
    manager._merged_params = {"write_map": {"fan": {"unit": "%"}}, "channels": []}
    assert manager.read_channels() == {}
    assert manager.read_units() == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["heater", "fan", "drum"])
@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf")])
async def test_non_finite_feedback_uses_stale_path(role, invalid):
    import json

    manager = RoasterManager()
    good = Reading(bt=190, et=210, heater=42.25, fan=1234.56, drum=31.25, timestamp=10)
    bad = Reading(bt=191, et=211, heater=42.25, fan=1234.56, drum=31.25, timestamp=11)
    setattr(bad, role, invalid)
    params = {"channels": [
        {"role": name, "db": 2, "offset": offset, "unit": unit}
        for name, offset, unit in [("heater", 48, "%"), ("fan", 52, "Pa"), ("drum", 18, "Hz")]
    ]}
    with patch("manager.make_adapter", return_value=FakeAdapter(readings=[good, bad])):
        await manager.connect("custom_s7", params)
    await manager.read_temperatures()
    result = await manager.read_temperatures()
    assert result["stale"] is True
    assert (result["heater"], result["fan"], result["drum"]) == (42.25, 1234.56, 31.25)
    json.dumps(result, allow_nan=False)
    await manager.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("key,params,expected", [
    ("custom_s7", {"channels": [{"role": "heater", "db": 2, "offset": 48}]}, {"heater": ""}),
    ("custom_modbus", {"modbus_registers": {"fan": {"register": 1}}}, {"fan": ""}),
    ("custom_probat_ws", {"channel_nodes": {"BT": "bean", "heater": "burner"}}, {"heater": ""}),
    ("custom_kaleido", {}, {"heater": "%", "fan": "%", "drum": "%"}),
    ("virtual", {}, {"heater": "%", "fan": "%", "drum": "%"}),
    ("virtual_readonly", {}, {}),
    ("custom_phidget", {}, {}),
])
async def test_available_feedback_is_published_without_inventing_channels_or_units(key, params, expected):
    manager = RoasterManager()
    reading = Reading(bt=190, et=210, heater=0, fan=0, drum=0, timestamp=10)
    with patch("manager.make_adapter", return_value=FakeAdapter(readings=[reading])):
        await manager.connect(key, params)
    assert manager.status()["read_units"] == expected
    result = await manager.read_temperatures()
    assert result["processing"]["read_units"] == expected
    for role in ("heater", "fan", "drum"):
        assert result[role] == (0 if role in expected else None)
    await manager.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [{}, {"fan": "bad", "drum": float("nan")}, {"fan": 0, "drum": 0}])
async def test_probat_missing_feedback_is_not_reported_as_measured_zero(data):
    import json
    from unittest.mock import AsyncMock
    from adapters.probat_ws import ProbatWSAdapter

    adapter = ProbatWSAdapter(channel_nodes={"BT": "bean", "fan": "fan", "drum": "drum"})
    adapter._ws = AsyncMock()
    adapter._ws.recv.return_value = json.dumps({"id": 1, "data": {"bean": 190, **data}})
    with patch("adapters.probat_ws.random.randint", return_value=1):
        reading = await adapter.read()
    expected = 0 if data.get("fan") == 0 else None
    assert reading.fan == expected
    assert reading.drum == expected

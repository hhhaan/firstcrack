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

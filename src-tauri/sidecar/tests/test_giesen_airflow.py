"""Protocol behavior against pinned Artisan facts, without connecting to a roaster."""

import json
import struct
from copy import deepcopy
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from adapters.s7 import S7Adapter
from manager import RoasterManager, _merge_connect_params
from roaster_registry import ROASTER_REGISTRY
from tests.conftest import FakeAdapter, make_reading
from tests.test_api import client  # noqa: F401 — shared HTTP fixture


FACTS = json.loads((Path(__file__).parent / "fixtures/giesen_artisan_io.json").read_text())
MODELS = [("giesen_w1", "W1A"), ("giesen_w1", "W1E"),
          ("giesen_w45a_w60a", "W45A"), ("giesen_w45a_w60a", "W60A")]


@pytest.mark.parametrize("key,model", MODELS)
async def test_reads_artisan_channels_with_distinct_pressure_percent_and_setpoints(key, model):
    params = ROASTER_REGISTRY[key]["default_params"]
    facts = FACTS["models"][model]
    offsets = [int(x) for x in facts["start"].split(",")]
    dbs = [int(x) for x in facts["db_nr"].split(",")]
    types = [int(x) for x in facts["type"].split(",")]
    values = [193.25, 216.75, 42, 112, 48, 210, 41, 120, 73]
    memory = {(db, offset): struct.pack(">f" if typ else ">h", value)
              for db, offset, typ, value in zip(dbs, offsets, types, values)}
    plc = MagicMock()
    plc.get_connected.return_value = True
    plc.db_read.side_effect = lambda db, offset, size: bytearray(memory[(db, offset)])
    adapter = S7Adapter(**params)
    adapter._plc = plc
    adapter._min_interval = 0
    by_role = {c["role"]: c for c in params["channels"]}
    adapter._bt_ch, adapter._et_ch, adapter._hp_ch, adapter._fc_ch, adapter._drum_ch = (
        by_role[r] for r in ("BT", "ET", "heater", "fan", "drum")
    )
    reading = await adapter.read()
    assert (reading.bt, reading.et) == (193.2, 216.8)
    assert (reading.heater, reading.fan, reading.drum) == (42, 112, 48)
    assert {e["id"]: (e["value"], e["unit"]) for e in reading.extra_readings} == {
        "fan_output": (73, "%"), "airflow_setpoint": (120, "Pa"),
        "temperature_setpoint": (210, "°C"), "heater_setpoint": (40, "%"),
    }
    assert {(c.args[0], c.args[1]) for c in plc.db_read.call_args_list} == set(memory)


@pytest.mark.parametrize("key,model", MODELS)
@pytest.mark.parametrize("role,index,offset", [("fan", 0, 16), ("drum", 1, 18)])
@pytest.mark.parametrize("requested", [-100, 45, 120, 999])
async def test_commands_use_artisan_limits_and_only_write_the_command_cell(key, model, role, index, offset, requested):
    params = ROASTER_REGISTRY[key]["default_params"]
    facts = FACTS["models"][model]
    minimum = int(facts["slidermin"].split(",")[index])
    maximum = int(facts["slidermax"].split(",")[index])
    assert f"setDBint(2,{offset},{{}})" in facts["slidercommands"]
    expected = max(minimum, min(maximum, requested))
    adapter = S7Adapter(**params)
    adapter._plc = MagicMock()
    memory = {}
    adapter._plc.db_write.side_effect = lambda db, offset, payload: memory.update({(db, offset): bytearray(payload)})
    adapter._plc.db_read.side_effect = lambda db, offset, size: memory[(db, offset)][:size]
    adapter._min_interval = 0
    manager = RoasterManager()
    manager._adapter = adapter
    manager._connected = True
    manager._protocol = "s7"
    manager._merged_params = params
    assert await manager.control(**{role: requested}) == {role: expected}
    adapter._plc.db_write.assert_called_once_with(2, offset, bytearray(struct.pack(">h", expected)))


@pytest.mark.parametrize("key", ["giesen_w1", "giesen_w45a_w60a"])
@pytest.mark.parametrize("heater_legacy", [False, True])
def test_saved_factory_settings_upgrade_but_custom_maps_do_not(key, heater_legacy):
    defaults = ROASTER_REGISTRY[key]["default_params"]
    saved = {
        "host": "192.0.2.10",
        "channels": [
            {**{k: v for k, v in c.items() if k != "unit"},
             **({"offset": 54} if c["role"] == "fan" else {})}
            for c in defaults["channels"] if c["role"] in {"BT", "ET", "heater", "fan", "drum"}
        ],
        "write_map": {r: deepcopy(defaults["write_map"][r])
                      for r in (["heater", "drum"] if key.endswith("w60a") else ["heater"])},
    }
    if heater_legacy:
        saved["write_map"]["heater"].pop("value_offset")
        saved["write_map"]["heater"].pop("verify_readback")
        saved["write_map"]["heater"]["min"] = 1
    before = deepcopy(saved)
    merged = _merge_connect_params(defaults, saved)
    assert merged["channels"] == defaults["channels"]
    assert merged["write_map"] == defaults["write_map"]
    assert merged["host"] == saved["host"]
    assert saved == before
    custom = deepcopy(saved)
    custom["channels"][3]["offset"] = 98
    custom["write_map"]["heater"]["db"] = 12
    merged = _merge_connect_params(defaults, custom)
    assert merged["channels"] == custom["channels"]
    assert merged["write_map"] == custom["write_map"]


@pytest.mark.parametrize("key", ["giesen_w1", "giesen_w45a_w60a"])
async def test_http_exposes_pressure_units_and_accepts_both_controls(client, key):
    with patch("manager.make_adapter", return_value=FakeAdapter()):
        assert (await client.post("/connect", json={"roaster": key})).status == 200
    status = await (await client.get("/status")).json()
    assert status["read_units"] == {"heater": "%", "fan": "Pa", "drum": "Hz"}
    assert status["control"]["limits"]["fan"]["unit"] == "Pa"
    result = await client.post("/control", json={"fan": 120, "drum": 50})
    assert result.status == 200
    assert (await result.json())["applied"] == {"fan": 120, "drum": 50}


@pytest.mark.parametrize("key", ["giesen_w1", "giesen_w45a_w60a"])
@pytest.mark.parametrize("saved_factory_map", [False, True])
@pytest.mark.parametrize("overrides,expected_address,unit", [
    ({"fan_db": 2, "fan_offset": 54}, (2, 54), "%"),
    ({"fan_offset": 54}, (2, 54), "%"),
    ({"fan_offset": 52}, (2, 52), "Pa"),
    ({"fan_db": 9}, (9, 52), None),
    ({"fan_offset": 98}, (2, 98), None),
])
def test_flat_fan_overrides_do_not_inherit_pressure_units(key, saved_factory_map, overrides, expected_address, unit):
    defaults = ROASTER_REGISTRY[key]["default_params"]
    params = dict(overrides)
    if saved_factory_map:
        params["channels"] = [
            {**{k: v for k, v in c.items() if k != "unit"},
             **({"offset": 54} if c["role"] == "fan" else {})}
            for c in defaults["channels"] if c["role"] in {"BT", "ET", "heater", "fan", "drum"}
        ]
    original_defaults, original_params = deepcopy(defaults), deepcopy(params)
    merged = _merge_connect_params(defaults, params)
    fan = next(c for c in merged["channels"] if c["role"] == "fan")
    assert (fan["db"], fan["offset"]) == expected_address
    assert fan.get("unit") == unit
    assert merged["write_map"] == defaults["write_map"]
    assert defaults == original_defaults
    assert params == original_params


@pytest.mark.parametrize("overrides", [{}, {"fan_db": 9, "fan_offset": 98}])
def test_unchanged_custom_fan_map_preserves_explicit_units_and_scaling(overrides):
    defaults = ROASTER_REGISTRY["giesen_w1"]["default_params"]
    channels = deepcopy(defaults["channels"])
    fan = next(c for c in channels if c["role"] == "fan")
    fan.update(db=9, offset=98, unit="Pa", div=1, compensation=2)
    merged = _merge_connect_params(defaults, {"channels": channels, **overrides})
    assert merged["channels"] == channels


@pytest.mark.parametrize("decoding", [{"div": 1}, {"compensation": 2}, {"area": 3}, {"type": 1}])
def test_changed_flat_fan_address_does_not_infer_units_for_custom_decoding(decoding):
    defaults = ROASTER_REGISTRY["giesen_w1"]["default_params"]
    channels = deepcopy(defaults["channels"])
    original_fan = next(c for c in channels if c["role"] == "fan")
    original_fan.update(decoding)
    merged = _merge_connect_params(defaults, {"channels": channels, "fan_offset": 54})
    fan = next(c for c in merged["channels"] if c["role"] == "fan")
    assert fan == {**{k: v for k, v in original_fan.items() if k != "unit"}, "offset": 54}
    assert original_fan["unit"] == "Pa"
    assert original_fan["offset"] == 52


@pytest.mark.parametrize("key", ["giesen_w1", "giesen_w45a_w60a"])
@pytest.mark.parametrize("offset,unit", [(52, "Pa"), (54, "%"), (98, None)])
async def test_http_flat_fan_overrides_publish_matching_feedback_units(client, key, offset, unit):
    with patch("manager.make_adapter", return_value=FakeAdapter(readings=[make_reading()] * 2)):
        result = await client.post("/connect", json={"roaster": key, "fan_db": 2, "fan_offset": offset})
    assert result.status == 200
    status = await (await client.get("/status")).json()
    assert status["read_units"].get("fan") == unit
    assert status["control"]["limits"]["fan"]["unit"] == "Pa"
    reading = await (await client.get("/temperatures")).json()
    assert reading["processing"]["read_units"] == status["read_units"]
    assert reading["fan"] == 60
    result = await client.post("/control", json={"fan": 120})
    assert result.status == 200
    assert (await result.json())["applied"] == {"fan": 120}


def test_other_models_do_not_inherit_w1_ranges():
    for key in ("giesen_sample", "giesen_standard"):
        params = ROASTER_REGISTRY[key]["default_params"]
        assert set(params["write_map"]) == {"heater"}
        assert next(c for c in params["channels"] if c["role"] == "fan")["offset"] == 54

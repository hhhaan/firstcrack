"""W1A/W1E and W45A/W60A airflow/drum maps from Artisan 16455e39e1f6.

Airflow commands are pressure (Pa), not the fan motor output (%). Keep both
readings, and only upgrade saved maps that exactly match the previous preset.
"""

from typing import Any


def with_airflow_controls(
    params: dict[str, Any], *, pressure: tuple[int, int], drum: tuple[int, int],
) -> dict[str, Any]:
    channels = []
    for channel in params["channels"]:
        role = channel["role"]
        unit = {"heater": "%", "fan": "Pa", "drum": "Hz"}.get(role)
        channels.append({
            **channel,
            **({"unit": unit} if unit else {}),
            **({"offset": 52} if role == "fan" else {}),
        })
    for role, offset, label, unit, compensation in (
        ("fan_output", 54, "Fan output", "%", 0),
        ("airflow_setpoint", 16, "Airflow setpoint", "Pa", 0),
        ("temperature_setpoint", 10, "Air temperature setpoint", "°C", 0),
        ("heater_setpoint", 14, "Machine gas setpoint", "%", -1),
    ):
        channels.append({
            "role": role, "db": 2, "offset": offset, "area": 6, "type": 0,
            "div": 0, "label": label, "unit": unit,
            **({"compensation": compensation} if compensation else {}),
        })
    return {
        **params,
        "channels": channels,
        "write_map": {
            **params["write_map"],
            "fan": {"db": 2, "offset": 16, "area": 6, "type": 0, "div": 0,
                    "min": pressure[0], "max": pressure[1], "unit": "Pa"},
            "drum": {"db": 2, "offset": 18, "area": 6, "type": 0, "div": 0,
                     "min": drum[0], "max": drum[1], "unit": "Hz"},
        },
    }


def _is_airflow_preset(defaults: dict[str, Any]) -> bool:
    write_map = defaults.get("write_map", {})
    fan = write_map.get("fan", {})
    return (fan.get("db"), fan.get("offset"), fan.get("unit")) == (2, 16, "Pa") and any(
        c.get("role") == "fan_output" for c in defaults.get("channels", [])
    )


def upgrade_saved_airflow_maps(defaults: dict[str, Any], merged: dict[str, Any]) -> None:
    """Preserve edited addresses, scales, units, and limits, including partial maps."""
    if not _is_airflow_preset(defaults):
        return
    write_map = defaults["write_map"]
    channels = defaults.get("channels", [])
    legacy_channels = [
        {**{k: v for k, v in c.items() if k != "unit"},
         **({"offset": 54} if c["role"] == "fan" else {})}
        for c in channels if c["role"] in {"BT", "ET", "heater", "fan", "drum"}
    ]
    if merged.get("channels") == legacy_channels:
        merged["channels"] = channels
    # Heater-only presets are upgraded by the common heater migration first.
    # W45A/W60A also had a factory heater+drum preset before airflow was added.
    previous_write_map = {r: write_map[r] for r in ("heater", "drum")}
    if merged.get("write_map") == previous_write_map:
        merged["write_map"] = dict(write_map)


def reconcile_airflow_override_units(
    defaults: dict[str, Any], previous_channels: Any, merged: dict[str, Any],
) -> None:
    """A changed flat address must not retain the old cell's feedback unit."""
    if not _is_airflow_preset(defaults) or not isinstance(previous_channels, list):
        return
    previous = next((c for c in previous_channels if isinstance(c, dict) and c.get("role") == "fan"), {})
    channels = merged.get("channels", [])
    fan = next((c for c in channels if isinstance(c, dict) and c.get("role") == "fan"), None)
    if fan is None or (fan.get("db"), fan.get("offset")) == (previous.get("db"), previous.get("offset")):
        return  # Unchanged custom maps keep their explicit units and calibration.

    # Infer only from a known airflow cell with the same decoding. An arbitrary
    # DB/offset or custom scale has no proven unit, so the UI must ignore it for Pa.
    fields = (("db", None), ("offset", None), ("area", 6), ("type", 0), ("div", 0), ("compensation", 0))
    source = next((c for c in defaults["channels"]
                   if c["role"] in {"fan", "fan_output", "airflow_setpoint"}
                   and all(c.get(field, fallback) == fan.get(field, fallback) for field, fallback in fields)), None)
    corrected = {k: v for k, v in fan.items() if k != "unit"}
    if source is not None:
        corrected["unit"] = source["unit"]
    merged["channels"] = [corrected if c is fan else c for c in channels]

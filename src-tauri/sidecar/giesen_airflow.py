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


def upgrade_saved_airflow_maps(defaults: dict[str, Any], merged: dict[str, Any]) -> None:
    """Preserve edited addresses, scales, units, and limits, including partial maps."""
    write_map = defaults.get("write_map", {})
    fan = write_map.get("fan", {})
    if (fan.get("db"), fan.get("offset"), fan.get("unit")) != (2, 16, "Pa"):
        return
    channels = defaults.get("channels", [])
    if not any(c.get("role") == "fan_output" for c in channels):
        return
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

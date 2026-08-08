"""Bühler registry ↔ Artisan .aset 1:1 channel map (read-only).

Parses vendored Artisan machine presets under tests/fixtures/artisan/Buhler/
and asserts shipped ROASTER_REGISTRY keys match connection params + S7
read channels (BT, IT→ET, Air→fan, Drum→drum).

Artisan sources:
  - Machines/Bühler/*.aset (S7 db/start/type)
  - canvas.py etypesdefault = [Air, Drum, Damper, Burner]
  - extraname {0}=etype0(Air), {1}=etype1(Drum)
  - quantifiersource event0←ch named {0}, event1←ch named {1}
"""

from __future__ import annotations

from pathlib import Path

import pytest

from roaster_registry import ROASTER_REGISTRY

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "artisan" / "Buhler"

# registry key → Artisan .aset filename
KEY_TO_ASET = {
    "buhler_rm20_simatic": "RM_20_Simatic.aset",
    "buhler_rm20_simatic_legacy": "RM_20_Simatic_Legacy.aset",
    "buhler_rm20_playone": "RM_20_Playone.aset",
    "buhler_rm60_240": "RM_60-240.aset",
}

# Extra S7 device ids → 0-based channel start (Artisan device 79 main = ch 0..1)
_EXTRA_DEV_BASE = {80: 2, 81: 4, 82: 6, 110: 8, 151: 10}

# Artisan type → FC type (FLOAT2INT read as float)
def _fc_type(artisan_type: int) -> int:
    return 1 if artisan_type in (1, 2) else 0


def _parse_ini(text: str) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    cur: str | None = None
    for line in text.splitlines():
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1]
            sections[cur] = {}
        elif "=" in line and cur is not None:
            k, _, v = line.partition("=")
            sections[cur][k] = v
    return sections


def _csv_int(s: str) -> list[int]:
    return [int(x.strip()) for x in s.split(",")]


def parse_artisan_buhler_aset(path: Path) -> dict:
    """Extract connection + named S7 channels from an Artisan Bühler .aset."""
    s = _parse_ini(path.read_text(encoding="utf-8", errors="replace"))
    s7 = s["S7"]
    extra = s.get("ExtraDev", {})
    style = s.get("Style", {})

    area = _csv_int(s7["area"])
    db = _csv_int(s7["db_nr"])
    start = _csv_int(s7["start"])
    typ = _csv_int(s7["type"])
    div = _csv_int(s7["div"])
    n = len(area)

    names = [""] * n
    names[0] = style.get("ETname", "ET")  # main ch1 (BT SP on Bühler)
    names[1] = "BT"
    devices = [int(x.strip()) for x in extra.get("extradevices", "").split(",") if x.strip()]
    extraname1 = [x.strip() for x in extra.get("extraname1", "").split(",")]
    extraname2 = [x.strip() for x in extra.get("extraname2", "").split(",")]
    for i, dev in enumerate(devices):
        base = _EXTRA_DEV_BASE.get(dev)
        if base is None:
            continue
        if i < len(extraname1):
            names[base] = extraname1[i]
        if i < len(extraname2):
            names[base + 1] = extraname2[i]

    by_name: dict[str, dict] = {}
    for i in range(n):
        if area[i] == 0:
            continue  # inactive (e.g. legacy state)
        by_name[names[i]] = {
            "db": db[i],
            "offset": start[i],
            "area": area[i],
            "artisan_type": typ[i],
            "div": div[i],
            "ch": i + 1,
            "name": names[i],
        }

    # Role map used by FC (read-only subset of Artisan channels)
    # fan = Air = {0}; drum = Drum = {1} (etypesdefault)
    role_from_artisan = {
        "BT": by_name["BT"],
        "ET": by_name["IT"],  # inlet/burner as ET substitute
        "fan": by_name["{0}"],  # Air
        "drum": by_name["{1}"],  # Drum
    }

    return {
        "host": s7["host"],
        "port": int(s7["port"]),
        "rack": int(s7["rack"]),
        "slot": int(s7["slot"]),
        "roles": role_from_artisan,
        "by_name": by_name,
    }


def _role_map(channels: list[dict]) -> dict[str, dict]:
    return {c["role"]: c for c in channels}


@pytest.mark.parametrize("key,aset_name", list(KEY_TO_ASET.items()))
def test_buhler_registry_matches_artisan_aset(key: str, aset_name: str) -> None:
    fixture = FIXTURES / aset_name
    assert fixture.is_file(), f"missing Artisan fixture: {fixture}"

    artisan = parse_artisan_buhler_aset(fixture)
    entry = ROASTER_REGISTRY[key]
    params = entry["default_params"]
    channels = params["channels"]
    roles = _role_map(channels)

    assert entry["protocol"] == "s7"
    assert entry["capabilities"] == []
    assert entry["pid"] is None
    assert params["host"] == artisan["host"]
    assert params["port"] == artisan["port"]
    assert params["rack"] == artisan["rack"]
    assert params["slot"] == artisan["slot"]

    for role, a_ch in artisan["roles"].items():
        assert role in roles, f"{key}: missing role {role}"
        f_ch = roles[role]
        assert f_ch["db"] == a_ch["db"], f"{key}.{role}.db"
        assert f_ch["offset"] == a_ch["offset"], f"{key}.{role}.offset"
        assert f_ch["area"] == a_ch["area"], f"{key}.{role}.area"
        assert f_ch["type"] == _fc_type(a_ch["artisan_type"]), f"{key}.{role}.type"
        assert f_ch.get("div", 0) == a_ch["div"], f"{key}.{role}.div"


def test_buhler_air_drum_not_swapped_simatic() -> None:
    """Guard: Air={0} off 24, Drum={1} off 8 on RM20 Simatic (regression for swap)."""
    artisan = parse_artisan_buhler_aset(FIXTURES / "RM_20_Simatic.aset")
    assert artisan["by_name"]["{0}"]["offset"] == 24  # Air → fan
    assert artisan["by_name"]["{1}"]["offset"] == 8  # Drum → drum
    roles = _role_map(ROASTER_REGISTRY["buhler_rm20_simatic"]["default_params"]["channels"])
    assert roles["fan"]["offset"] == 24
    assert roles["drum"]["offset"] == 8


def test_all_buhler_keys_present() -> None:
    for key in KEY_TO_ASET:
        assert key in ROASTER_REGISTRY
        assert ROASTER_REGISTRY[key]["brand"] == "Bühler"

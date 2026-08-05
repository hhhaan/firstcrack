"""Structural feasibility checks for Giesen W60-class control.

Drives shipped sidecar modules (registry + S7 adapter source) to prove:
- giesen_standard covers W60A with heater/fan/drum *read* channels
- S7Adapter.control is currently a no-op (no PLC write)
- write offsets known from Artisan W60A.aset differ from heater *read* offset

These tests document current capability; they do not implement control.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from roaster_registry import ROASTER_REGISTRY
from adapters.s7 import S7Adapter


SIDECAR_ROOT = Path(__file__).resolve().parents[1]
# tests/ → sidecar → src-tauri → fc-desktop → first-crack-proj
REPO_ROOT = Path(__file__).resolve().parents[4]
ARTISAN_W60A = (
    REPO_ROOT
    / "artisan"
    / "src"
    / "includes"
    / "Machines"
    / "Giesen"
    / "W60A.aset"
)


def _role_map(channels: list[dict]) -> dict[str, dict]:
    return {c["role"]: c for c in channels}


def test_giesen_standard_includes_w60a_and_control_capabilities() -> None:
    entry = ROASTER_REGISTRY["giesen_standard"]
    assert entry["protocol"] == "s7"
    assert "W60A" in entry["models"]
    assert set(entry["capabilities"]) >= {"heater", "fan", "drum"}
    roles = _role_map(entry["default_params"]["channels"])
    # Read map aligned with Artisan W60A-class (telemetry)
    assert (roles["BT"]["db"], roles["BT"]["offset"]) == (3, 116)
    assert (roles["ET"]["db"], roles["ET"]["offset"]) == (3, 112)
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (2, 48)
    assert (roles["fan"]["db"], roles["fan"]["offset"]) == (2, 10)
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (2, 14)


def test_s7_adapter_control_is_noop_pass_only() -> None:
    src_path = SIDECAR_ROOT / "adapters" / "s7.py"
    tree = ast.parse(src_path.read_text(encoding="utf-8"))
    control_fn = None
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "S7Adapter":
            for item in node.body:
                if isinstance(item, ast.AsyncFunctionDef) and item.name == "control":
                    control_fn = item
                    break
    assert control_fn is not None, "S7Adapter.control missing"
    # Only Pass (and optional docstring) — no write calls
    stmts = [s for s in control_fn.body if not isinstance(s, ast.Expr)]
    assert len(stmts) == 1 and isinstance(stmts[0], ast.Pass), (
        "S7Adapter.control must be no-op until write maps ship; "
        f"got {[type(s).__name__ for s in stmts]}"
    )
    text = src_path.read_text(encoding="utf-8")
    assert "db_write" not in text
    assert "write_area" not in text


@pytest.mark.asyncio
async def test_s7_adapter_control_does_not_require_connection() -> None:
    """Calling control on a disconnected adapter must not raise (no-op)."""
    adapter = S7Adapter(host="127.0.0.1", channels=[
        {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
    ])
    await adapter.control(heater=50.0, fan=30.0, drum=40.0)


def test_main_exposes_post_control_route() -> None:
    main_src = (SIDECAR_ROOT / "main.py").read_text(encoding="utf-8")
    assert "async def handle_control" in main_src
    assert 'add_post("/control"' in main_src


def test_artisan_w60a_write_map_differs_from_heater_read_offset() -> None:
    """Artisan writes heater duty at DB2.14; feedback read is DB2.48."""
    if not ARTISAN_W60A.is_file():
        pytest.skip(f"W60A.aset not found at {ARTISAN_W60A}")
    text = ARTISAN_W60A.read_text(encoding="utf-8", errors="replace")
    assert 'slidercommands="setDBint(2,16,{})", "setDBint(2,18,{})", "setDBint(2,10,{})", "setDBint(2,14,{})"' in text
    assert 'PID_ON_action="setDBint(2,14,0)"' in text
    assert "start=116, 112, 48," in text or "start=116,112,48," in text.replace(" ", "")

    roles = _role_map(ROASTER_REGISTRY["giesen_standard"]["default_params"]["channels"])
    # Heater *read* feedback must not be confused with Artisan duty *write* offset
    assert roles["heater"]["offset"] == 48
    assert roles["drum"]["offset"] == 14  # same cell Artisan uses for % setpoint write


def test_giesen_py_is_csv_import_not_control() -> None:
    giesen = REPO_ROOT / "artisan" / "src" / "artisanlib" / "giesen.py"
    if not giesen.is_file():
        pytest.skip("artisan giesen.py not in tree")
    src = giesen.read_text(encoding="utf-8")
    assert "extractProfileGiesenCSV" in src
    assert "snap7" not in src
    assert "writeInt" not in src

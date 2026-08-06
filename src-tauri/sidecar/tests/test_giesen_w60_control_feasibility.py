"""Giesen W60-class 제어 경로의 주소 맵 검증.

레지스트리(읽기 channels + 쓰기 write_map)가 Artisan의 W60A.aset과 일치하는지
확인한다. 여기서 지키는 핵심 불변식은 **읽기 셀과 쓰기 셀의 분리**다:

  DB2.48  heater 피드백 (읽기 전용)
  DB2.14  heater duty 세트포인트 (읽기 + 쓰기)  ← control()이 쓰는 셀
  DB2.18  drum Hz
  DB2.10  fan

DB2.14를 drum으로 잘못 읽으면 heater를 쓰는 순간 UI drum 수치가 명령값을
따라가는 거짓 표시가 된다. 아래 회귀 테스트가 그 재발을 막는다.
"""

from __future__ import annotations

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

# db2 계열 Giesen (W1A~W140A, WxA/WxA+) — 슬라이더 쓰기 맵이 전 기종 동일
GIESEN_DB2_KEYS = [
    "giesen_w1",
    "giesen_standard",
    "giesen_w15e",
    "giesen_w30a_pro",
    "giesen_w140a_v2",
    "giesen_wxa",
    "giesen_wxa_plus",
]


def _role_map(channels: list[dict]) -> dict[str, dict]:
    return {c["role"]: c for c in channels}


def test_giesen_standard_includes_w60a_and_control_capabilities() -> None:
    entry = ROASTER_REGISTRY["giesen_standard"]
    assert entry["protocol"] == "s7"
    assert "W60A" in entry["models"]
    assert set(entry["capabilities"]) >= {"heater", "fan", "drum"}
    roles = _role_map(entry["default_params"]["channels"])
    # 읽기 맵 — Artisan W60A-class 텔레메트리
    assert (roles["BT"]["db"], roles["BT"]["offset"]) == (3, 116)
    assert (roles["ET"]["db"], roles["ET"]["offset"]) == (3, 112)
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (2, 48)
    assert (roles["fan"]["db"], roles["fan"]["offset"]) == (2, 10)
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (2, 18)


@pytest.mark.parametrize("key", GIESEN_DB2_KEYS)
def test_db2_giesen_reads_drum_at_18_not_heater_setpoint(key: str) -> None:
    """회귀 방지: DB2.14는 heater duty 세트포인트지 drum이 아니다."""
    roles = _role_map(ROASTER_REGISTRY[key]["default_params"]["channels"])
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (2, 18)


@pytest.mark.parametrize("key", GIESEN_DB2_KEYS)
def test_db2_giesen_write_map_targets_heater_setpoint(key: str) -> None:
    write_map = ROASTER_REGISTRY[key]["default_params"]["write_map"]
    heater = write_map["heater"]
    assert (heater["db"], heater["offset"]) == (2, 14)
    assert (heater["min"], heater["max"]) == (0, 100)
    # 쓰기 대상이 읽기 role 어느 것과도 겹치지 않아야 한다 (피드백 덮어쓰기 방지)
    roles = _role_map(ROASTER_REGISTRY[key]["default_params"]["channels"])
    for role in ("heater", "fan", "drum"):
        assert (roles[role]["db"], roles[role]["offset"]) != (heater["db"], heater["offset"])


def test_w6a_pro_reads_drum_at_62() -> None:
    """W6A PRO도 같은 오라벨이 있었다: DB1006.106은 heater % 세트포인트."""
    roles = _role_map(ROASTER_REGISTRY["giesen_w6a_pro"]["default_params"]["channels"])
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (1006, 62)
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (1006, 98)


def test_non_giesen_s7_has_no_write_map() -> None:
    """write_map 부재 = 쓰기 미지원. Probat은 쓰기 맵을 검증한 적이 없다."""
    for key in ("probat_gug_s7", "probat_gug_control_s7"):
        assert "write_map" not in ROASTER_REGISTRY[key]["default_params"]


@pytest.mark.asyncio
async def test_s7_adapter_control_does_not_require_connection() -> None:
    """미연결 어댑터의 control()은 예외 없이 no-op이어야 한다."""
    adapter = S7Adapter(host="127.0.0.1", channels=[
        {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
    ])
    await adapter.control(heater=50.0, fan=30.0, drum=40.0)


def test_main_exposes_post_control_route() -> None:
    main_src = (SIDECAR_ROOT / "main.py").read_text(encoding="utf-8")
    assert "async def handle_control" in main_src
    assert 'add_post("/control"' in main_src


def test_artisan_w60a_confirms_write_cells() -> None:
    """레지스트리 쓰기 맵의 출처 대조 (artisan 체크아웃 있을 때만)."""
    if not ARTISAN_W60A.is_file():
        pytest.skip(f"W60A.aset not found at {ARTISAN_W60A}")
    text = ARTISAN_W60A.read_text(encoding="utf-8", errors="replace")
    # 슬라이더 순서: pressure(16), drum Hz(18), fan(10), heater %(14)
    assert 'slidercommands="setDBint(2,16,{})", "setDBint(2,18,{})", "setDBint(2,10,{})", "setDBint(2,14,{})"' in text
    assert "eventsliderunits=Pa, Hz, , %" in text
    # heater 슬라이더(마지막) 범위 0~100 → write_map min/max의 출처
    assert "slidermax=170, 55, 280, 100" in text
    assert "slidermin=100, 40, 0, 0" in text
    # PID_area=0 → Giesen에는 PLC 네이티브 PID가 없다. software PID + duty 쓰기가 유일 경로.
    assert "PID_area=0" in text

    heater_write = ROASTER_REGISTRY["giesen_standard"]["default_params"]["write_map"]["heater"]
    roles = _role_map(ROASTER_REGISTRY["giesen_standard"]["default_params"]["channels"])
    assert heater_write["offset"] == 14          # Artisan이 쓰는 셀
    assert roles["heater"]["offset"] == 48       # 피드백 — 쓰면 안 되는 셀
    assert roles["drum"]["offset"] == 18         # Artisan 슬라이더 1번 (Hz)


def test_giesen_py_is_csv_import_not_control() -> None:
    giesen = REPO_ROOT / "artisan" / "src" / "artisanlib" / "giesen.py"
    if not giesen.is_file():
        pytest.skip("artisan giesen.py not in tree")
    src = giesen.read_text(encoding="utf-8")
    assert "extractProfileGiesenCSV" in src
    assert "snap7" not in src
    assert "writeInt" not in src

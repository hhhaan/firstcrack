"""Giesen W60-class 제어 경로의 주소 맵 검증.

레지스트리(읽기 channels + 쓰기 write_map)가 Artisan의 W60A.aset과 일치하는지
확인한다. **화력 명령과 피드백은 분리**하고, 드럼은 같은 셀을 읽고 쓴다:

  DB2.48  heater 피드백 (읽기 전용)
  DB2.14  heater duty 세트포인트 (읽기 + 쓰기)  ← control()이 쓰는 셀
  DB2.18  drum Hz (W45A/W60A 읽기 + 쓰기)
  DB2.54  fan % (읽기 전용)
  DB2.10  temperature SP (쓰기 미노출)

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

# DB2.14 계열 Giesen — coarse만 논리 범위가 0~10이다.
GIESEN_DB2_KEYS = [
    "giesen_w1",
    "giesen_sample",
    "giesen_standard",
    "giesen_w30a",
    "giesen_w45a_w60a",
    "giesen_w15e",
    "giesen_w140a_v1",
    "giesen_w30a_pro",
    "giesen_w140a_v2",
    "giesen_wxa",
    "giesen_wxa_plus",
    "giesen_wxa_coarse",
]


def _role_map(channels: list[dict]) -> dict[str, dict]:
    return {c["role"]: c for c in channels}


def test_giesen_w45a_w60a_matches_artisan_host_and_control_capabilities() -> None:
    entry = ROASTER_REGISTRY["giesen_w45a_w60a"]
    assert entry["protocol"] == "s7"
    assert "W60A" in entry["models"]
    # W60A.aset host= — giesen_standard(.50)에 묶여 있던 잘못된 기본 IP 회귀 방지
    assert entry["default_params"]["host"] == "172.30.30.90"
    assert entry["default_params"]["channels"] == ROASTER_REGISTRY["giesen_standard"]["default_params"]["channels"]
    assert set(entry["capabilities"]) >= {"heater", "fan", "drum"}
    roles = _role_map(entry["default_params"]["channels"])
    # 읽기 맵 — Artisan W60A-class 텔레메트리
    assert (roles["BT"]["db"], roles["BT"]["offset"]) == (3, 116)
    assert (roles["ET"]["db"], roles["ET"]["offset"]) == (3, 112)
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (2, 48)
    # fan% = DB2.54 (aset "{0} %"). DB2.10은 PID SV 레지스터 — fan으로 읽으면 안 된다.
    assert (roles["fan"]["db"], roles["fan"]["offset"]) == (2, 54)
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
    assert (heater["min"], heater["max"]) == (0, 10 if key == "giesen_wxa_coarse" else 100)
    assert heater["value_offset"] == 1
    # 화력 쓰기 대상은 읽기 role과 겹치지 않아야 한다 (드럼은 DB2.18을 읽고 쓴다).
    roles = _role_map(ROASTER_REGISTRY[key]["default_params"]["channels"])
    # WxA/WxA+는 fan 읽기 채널이 없다 (aset에 fan% 채널 부재) — 있는 role만 검사.
    for role in ("heater", "fan", "drum"):
        if role not in roles:
            continue
        assert (roles[role]["db"], roles[role]["offset"]) != (heater["db"], heater["offset"])


def test_only_w45a_w60a_exposes_the_artisan_drum_slider() -> None:
    params = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
    assert set(params["write_map"]) == {"heater", "drum"}
    drum = params["write_map"]["drum"]
    assert (drum["db"], drum["offset"], drum["area"], drum["type"], drum["div"]) == (2, 18, 6, 0, 0)
    assert (drum["min"], drum["max"], drum["unit"]) == (40, 55, "Hz")
    assert drum.get("value_offset", 0) == 0
    # Drum deliberately shares its command/read cell; heater feedback must stay separate.
    read_drum = _role_map(params["channels"])["drum"]
    assert (read_drum["db"], read_drum["offset"]) == (drum["db"], drum["offset"])
    for key in GIESEN_DB2_KEYS + ["giesen_w6a_pro"]:
        if key != "giesen_w45a_w60a":
            assert set(ROASTER_REGISTRY[key]["default_params"]["write_map"]) == {"heater"}, key


@pytest.mark.parametrize("key", GIESEN_DB2_KEYS + ["giesen_w6a_pro"])
def test_control_roles_never_share_a_read_cell(key: str) -> None:
    """heater/fan/drum/BT/ET가 같은 셀을 읽으면 UI에 남의 값이 표시된다.

    WxA+가 실제로 그랬다 — heater와 drum이 둘 다 DB2.18을 읽고 있었다.
    (AT/extra는 aset 자체가 같은 셀을 중복 참조하는 기종이 있어 제외한다.)
    """
    channels = ROASTER_REGISTRY[key]["default_params"]["channels"]
    cells: dict[tuple[int, int], str] = {}
    for ch in channels:
        if ch["role"] not in ("BT", "ET", "heater", "fan", "drum"):
            continue
        cell = (ch["db"], ch["offset"])
        assert cell not in cells, (
            f"{key}: {ch['role']}와 {cells[cell]}가 같은 셀 {cell}을 읽는다"
        )
        cells[cell] = ch["role"]


def test_wxa_plus_heater_reads_db4() -> None:
    """WxA+는 피드백이 db4에 있다 — db2/18은 drum Hz다."""
    roles = _role_map(ROASTER_REGISTRY["giesen_wxa_plus"]["default_params"]["channels"])
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (4, 18)
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (2, 18)


def test_w6a_pro_reads_drum_at_62() -> None:
    """W6A PRO도 같은 오라벨 오류가 있었다: drum은 DB1006.62, heater 피드백은 DB1006.98."""
    roles = _role_map(ROASTER_REGISTRY["giesen_w6a_pro"]["default_params"]["channels"])
    assert (roles["drum"]["db"], roles["drum"]["offset"]) == (1006, 62)
    assert (roles["heater"]["db"], roles["heater"]["offset"]) == (1006, 98)


def test_w6a_pro_write_map_targets_db1001_42() -> None:
    """W6A PRO는 읽기 db1006 / 쓰기 db1001로 계열이 다르다."""
    heater = ROASTER_REGISTRY["giesen_w6a_pro"]["default_params"]["write_map"]["heater"]
    assert (heater["db"], heater["offset"]) == (1001, 42)
    # PRO는 AUTO 센티널이 -1이라 0이 정상 버너 값 — DB2 계열과 달리 하한을 올리지 않는다
    assert (heater["min"], heater["max"]) == (0, 100)


def test_w6a_pro_pid_sv_register_is_never_written() -> None:
    """DB1001.24는 fan 세트포인트(REAL)다 — SV로 쓰면 팬이 오작동한다.

    레지스트리에 값이 남아 있어도 쓰기 경로(write_map)에는 절대 들어가면 안 된다.
    """
    params = ROASTER_REGISTRY["giesen_w6a_pro"]["default_params"]
    write_cells = {(spec["db"], spec["offset"]) for spec in params["write_map"].values()}
    assert (params["pid_db"], params["pid_sv_register"]) not in write_cells
    assert (1001, 24) not in write_cells


def test_w6a_pro_aset_confirms_fan_owns_register_24() -> None:
    aset = ARTISAN_W60A.parent / "W6A_PRO.aset"
    if not aset.is_file():
        pytest.skip("W6A_PRO.aset not in tree")
    text = aset.read_text(encoding="utf-8", errors="replace")
    # 슬라이더 순서: pressure(30), drum(22), fan(24, REAL), heater(42)
    assert 'setDBfloat(1001,24,{})' in text, "레지스터 24는 fan REAL 셀이어야 한다"
    assert 'setDBint(1001,42,{})' in text
    assert "PID_area=0" in text


def test_read_only_probat_s7_has_no_write_map() -> None:
    """G/UG 읽기 전용 프리셋은 G/UG Control의 쓰기 맵을 공유하지 않는다."""
    assert "write_map" not in ROASTER_REGISTRY["probat_gug_s7"]["default_params"]


@pytest.mark.asyncio
async def test_s7_adapter_control_without_plc_does_not_succeed() -> None:
    """write_map이 있어도 PLC가 없으면 성공으로 끝나면 안 된다 (#270)."""
    adapter = S7Adapter(
        host="127.0.0.1",
        channels=[
            {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
        ],
        write_map={
            "heater": {
                "db": 2,
                "offset": 14,
                "type": 0,
                "div": 0,
                "min": 0,
                "max": 100,
            }
        },
    )
    with pytest.raises(ConnectionError, match="연결되지 않음"):
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
    # 슬라이더 순서: pressure(16), drum Hz(18), temperature SP(10), heater %(14)
    assert 'slidercommands="setDBint(2,16,{})", "setDBint(2,18,{})", "setDBint(2,10,{})", "setDBint(2,14,{})"' in text
    assert "eventsliderunits=Pa, Hz, , %" in text
    # heater 슬라이더(마지막) 범위 0~100 → write_map min/max의 출처
    assert "slidermax=170, 55, 280, 100" in text
    assert "slidermin=100, 40, 0, 0" in text
    # PID_area=0 disables Artisan's external S7 PID route, not the machine's AUTO mode.
    assert "PID_area=0" in text

    heater_write = ROASTER_REGISTRY["giesen_standard"]["default_params"]["write_map"]["heater"]
    roles = _role_map(ROASTER_REGISTRY["giesen_standard"]["default_params"]["channels"])
    assert heater_write["offset"] == 14          # Artisan이 쓰는 셀
    assert roles["heater"]["offset"] == 48       # 피드백 — 쓰면 안 되는 셀
    assert roles["drum"]["offset"] == 18         # Artisan 슬라이더 1번 (Hz)
    drum_write = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]["write_map"]["drum"]
    assert (drum_write["offset"], drum_write["min"], drum_write["max"], drum_write["unit"]) == (18, 40, 55, "Hz")


def test_giesen_py_is_csv_import_not_control() -> None:
    giesen = REPO_ROOT / "artisan" / "src" / "artisanlib" / "giesen.py"
    if not giesen.is_file():
        pytest.skip("artisan giesen.py not in tree")
    src = giesen.read_text(encoding="utf-8")
    assert "extractProfileGiesenCSV" in src
    assert "snap7" not in src
    assert "writeInt" not in src


def test_giesen_variant_hosts_match_artisan_asets() -> None:
    """host만 다른 파생 항목 — 각 .aset의 host= 값."""
    expected = {
        "giesen_sample": "172.30.30.10",
        "giesen_w30a": "172.30.30.70",
        "giesen_w45a_w60a": "172.30.30.90",
        "giesen_w140a_v1": "172.30.30.110",
        "giesen_wxa_coarse": "192.168.3.230",
    }
    for key, host in expected.items():
        assert ROASTER_REGISTRY[key]["default_params"]["host"] == host, key
    # coarse는 버너 0~10 스텝(aset sliderfactors 0.1) — % 맵을 공유하면 범위 초과
    assert ROASTER_REGISTRY["giesen_wxa_coarse"]["default_params"]["write_map"]["heater"]["max"] == 10
    assert ROASTER_REGISTRY["giesen_wxa_coarse"]["default_params"]["write_map"]["heater"]["unit"] == "step"
    assert ROASTER_REGISTRY["giesen_wxa"]["default_params"]["write_map"]["heater"]["max"] == 100


def test_classic_giesen_never_writes_zero_to_burner_setpoint() -> None:
    """논리 0에 +1을 더해 DB2.14 raw 0(AUTO)을 피한다 (Artisan #827)."""
    for key in GIESEN_DB2_KEYS:
        heater = ROASTER_REGISTRY[key]["default_params"]["write_map"]["heater"]
        assert heater["min"] == 0, key
        assert heater["value_offset"] == 1, key


def test_w6a_pro_keeps_zero_as_a_valid_burner_value() -> None:
    """W6A PRO는 AUTO 센티널이 -1이고 슬라이더 오프셋도 0 — 0은 정상 값이다."""
    heater = ROASTER_REGISTRY["giesen_w6a_pro"]["default_params"]["write_map"]["heater"]
    assert heater["min"] == 0
    assert heater.get("value_offset", 0) == 0


@pytest.mark.parametrize("key", GIESEN_DB2_KEYS)
def test_classic_giesen_migrates_only_the_legacy_default_heater_map(key: str) -> None:
    from copy import deepcopy
    from manager import _merge_connect_params

    defaults = ROASTER_REGISTRY[key]["default_params"]
    legacy = deepcopy(defaults["write_map"])
    legacy["heater"].pop("value_offset", None)
    legacy["heater"]["min"] = 1
    saved = {**legacy, "fan": {"db": 2, "offset": 10}}
    merged = _merge_connect_params(defaults, {"host": "192.168.1.2", "write_map": saved})
    assert merged["write_map"]["heater"] == defaults["write_map"]["heater"]
    assert merged["write_map"]["heater"]["value_offset"] == 1
    assert merged["write_map"]["fan"] == saved["fan"]
    assert merged["host"] == "192.168.1.2"
    assert saved["heater"]["min"] == 1
    assert "value_offset" not in saved["heater"]
    for field, value in (("offset", 16), ("db", 3), ("div", 1), ("value_offset", 0)):
        custom = {"heater": {**legacy["heater"], field: value}}
        assert _merge_connect_params(defaults, {"write_map": custom})["write_map"] == custom
    corrected = defaults["write_map"]
    assert _merge_connect_params(defaults, {"write_map": corrected})["write_map"] == corrected
    assert _merge_connect_params(defaults, {"write_map": {}})["write_map"] == defaults["write_map"]


@pytest.mark.parametrize("legacy", [False, True])
def test_w45a_w60a_adds_drum_to_saved_default_heater_only_maps(legacy: bool) -> None:
    from copy import deepcopy
    from manager import _merge_connect_params

    defaults = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
    saved = {"heater": deepcopy(defaults["write_map"]["heater"])}
    if legacy:
        saved["heater"].pop("value_offset")
        saved["heater"]["min"] = 1
    original = deepcopy(saved)
    merged = _merge_connect_params(defaults, {"host": "192.168.1.2", "write_map": saved})
    assert merged["write_map"] == defaults["write_map"]
    assert merged["host"] == "192.168.1.2"
    assert saved == original


def test_w45a_w60a_preserves_saved_custom_drum_maps() -> None:
    from copy import deepcopy
    from manager import _merge_connect_params

    defaults = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
    saved = deepcopy(defaults["write_map"])
    saved["drum"]["max"] = 45
    assert _merge_connect_params(defaults, {"write_map": saved})["write_map"] == saved


@pytest.mark.parametrize("key", GIESEN_DB2_KEYS + ["giesen_w6a_pro"])
def test_giesen_clamp_keeps_logical_zero(key: str) -> None:
    """API applied와 저장·Replay에는 PLC 인코딩 오프셋을 더하지 않는다."""
    from control_guard import clamp_command

    write_map = ROASTER_REGISTRY[key]["default_params"]["write_map"]
    assert clamp_command({"heater": 0.0}, write_map) == {"heater": 0.0}

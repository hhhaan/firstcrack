"""Artisan 대조(2026-08-23)에서 잡힌 role 오배정 회귀 가드.

출처: artisan/src/includes/Machines/{Giesen,Probat,Loring}/*.aset
채널 순서 규약: idx0=BT, idx1=ET (comm.py), extraname1 ↔ 짝수 인덱스 (canvas.py).
"""

from roaster_registry import ROASTER_REGISTRY

GIESEN_DB2_KEYS = [
    "giesen_w1",
    "giesen_standard",
    "giesen_w15e",
    "giesen_w30a_pro",
    "giesen_w140a_v2",
    "giesen_wxa",
    "giesen_wxa_plus",
]


def _roles(key: str) -> dict[str, dict]:
    return {c["role"]: c for c in ROASTER_REGISTRY[key]["default_params"]["channels"]}


def test_no_giesen_read_channel_touches_pid_sv_register() -> None:
    """DB2.10은 PID SV 쓰기 셀(aset PID_SV_register=10) — 읽기 role로 노출 금지."""
    for key in GIESEN_DB2_KEYS:
        for ch in ROASTER_REGISTRY[key]["default_params"]["channels"]:
            assert (ch["db"], ch["offset"]) != (2, 10), f"{key}:{ch['role']}"


def test_probat_gug_gauges_are_int_cells_not_temperatures() -> None:
    """G_UG.aset: heater=Burner{3}=100/28, drum={1}=100/22, fan=Air{0}=100/30 (INT).

    회귀 이력: heater가 db100/0(IT, REAL °C)을 읽어 온도가 %게이지에 표시됐다.
    """
    roles = _roles("probat_gug_s7")
    assert (roles["heater"]["db"], roles["heater"]["offset"], roles["heater"]["type"]) == (100, 28, 0)
    assert (roles["fan"]["db"], roles["fan"]["offset"], roles["fan"]["type"]) == (100, 30, 0)
    assert (roles["drum"]["db"], roles["drum"]["offset"], roles["drum"]["type"]) == (100, 22, 0)


def test_probat_gug_control_gauges_are_int_cells_not_temperatures() -> None:
    """G_UG_control.aset: heater={3}=200/80, fan={0}=200/64, drum={1}=200/72 (INT)."""
    roles = _roles("probat_gug_control_s7")
    assert (roles["heater"]["db"], roles["heater"]["offset"], roles["heater"]["type"]) == (200, 80, 0)
    assert (roles["fan"]["db"], roles["fan"]["offset"], roles["fan"]["type"]) == (200, 64, 0)
    assert (roles["drum"]["db"], roles["drum"]["offset"], roles["drum"]["type"]) == (200, 72, 0)


_FACTORY_MODBUS = (
    "imf_rm",
    "imf_rm_auto",
    "imf_rm_control",
    "imf_rm_legacy",
    "petroncini_asem",
    "neuhaus_neoroast",
    "neuhaus_rfb",
)
_FACTORY_S7 = (
    "petroncini_maestro",
    "petroncini_traditional",
    "petroncini_maestro_i06",
)


def test_factory_lines_without_artisan_sliders_stay_read_only() -> None:
    """슬라이더 명령이 없는 aset은 쓰기 맵을 만들지 않는다."""
    writable = {"imf_rm_auto", "imf_rm_control"}
    for key in (*_FACTORY_MODBUS, *_FACTORY_S7):
        if key in writable:
            continue
        entry = ROASTER_REGISTRY[key]
        assert entry["capabilities"] == [], key
        assert "write_map" not in entry["default_params"], key


def test_imf_control_writes_inlet_setpoint_and_air() -> None:
    """RM_auto/RM_control: 화력=IT SV reg 24 °C, 에어=Air reg 42 %. Drum 쓰기는 없다."""
    for key in ("imf_rm_auto", "imf_rm_control"):
        entry = ROASTER_REGISTRY[key]
        assert entry["capabilities"] == ["heater", "fan"]
        write = entry["default_params"]["write_map"]
        assert write["heater"] == {
            "register": 24, "unit_id": 1, "float": True, "min": 0, "max": 550, "unit": "C",
        }
        assert write["fan"]["register"] == 42
        assert (write["fan"]["min"], write["fan"]["max"], write["fan"]["unit"]) == (50, 100, "%")
        assert "drum" not in write
        assert entry["default_params"]["modbus_registers"]["heater"]["register"] == 24


def test_imf_rm_float_inputs() -> None:
    """RM.aset: input1=10 BT, input2=12 ET, float, wordorderLittle=false."""
    params = ROASTER_REGISTRY["imf_rm"]["default_params"]
    assert params["host"] == "192.168.2.32"
    assert params["word_order"] == "big"
    assert params["modbus_registers"]["BT"]["register"] == 10
    assert params["modbus_registers"]["ET"]["register"] == 12
    assert params["modbus_registers"]["BT"]["float"] is True


def test_imf_control_air_and_drum() -> None:
    """RM_auto/RM_control: {0} Air=reg 42, {1} Drum=reg 32. 둘 다 float."""
    for key in ("imf_rm_auto", "imf_rm_control"):
        regs = ROASTER_REGISTRY[key]["default_params"]["modbus_registers"]
        assert regs["BT"]["register"] == 10
        assert regs["fan"] == {
            "register": 42, "func": 3, "unit_id": 1, "float": True, "div": 0, "mode": "", "unit": "%",
        }
        assert regs["drum"]["register"] == 32
        assert regs["drum"]["unit"] == "%"


def test_imf_legacy_is_int_holding() -> None:
    """RM_legacy.aset: input1=0, input2=1, not float."""
    regs = ROASTER_REGISTRY["imf_rm_legacy"]["default_params"]["modbus_registers"]
    assert regs["BT"]["register"] == 0
    assert regs["ET"]["register"] == 1
    assert regs["BT"]["float"] is False
    assert "word_order" not in ROASTER_REGISTRY["imf_rm_legacy"]["default_params"]


def test_petroncini_asem_float_holding() -> None:
    """TT_ASEM.aset: input1=10408 BT, input2=10404 ET, wordorderLittle=true."""
    params = ROASTER_REGISTRY["petroncini_asem"]["default_params"]
    assert params["host"] == "192.168.5.11"
    assert params["word_order"] == "little"
    regs = params["modbus_registers"]
    assert regs["BT"]["register"] == 10408
    assert regs["ET"]["register"] == 10404
    assert regs["BT"]["float"] is True


def test_neuhaus_input_registers() -> None:
    """Neoroast/RFB: input1=reg 2 BT, input2=reg 1 ET, code 4, ÷10. RFB is UDP."""
    for key in ("neuhaus_neoroast", "neuhaus_rfb"):
        regs = ROASTER_REGISTRY[key]["default_params"]["modbus_registers"]
        assert regs["BT"]["register"] == 2
        assert regs["ET"]["register"] == 1
        assert regs["BT"]["func"] == 4
        assert regs["BT"]["div"] == 1
    assert ROASTER_REGISTRY["neuhaus_neoroast"]["default_params"]["mode"] == "tcp"
    assert ROASTER_REGISTRY["neuhaus_neoroast"]["default_params"]["host"] == "192.268.5.89"
    assert ROASTER_REGISTRY["neuhaus_rfb"]["default_params"]["mode"] == "udp"
    assert ROASTER_REGISTRY["neuhaus_rfb"]["default_params"]["host"] == "192.168.111.99"


def test_petroncini_maestro_reads_merkers() -> None:
    """Maestro/Traditional area=3 (MK). i06 is DB31: Burner/Gas/DrumSpeed/Airflow."""
    maestro = {c["role"]: c for c in ROASTER_REGISTRY["petroncini_maestro"]["default_params"]["channels"]}
    assert (maestro["BT"]["area"], maestro["BT"]["offset"], maestro["BT"]["type"]) == (3, 32, 0)
    assert (maestro["ET"]["offset"]) == 34
    traditional = {c["role"]: c for c in ROASTER_REGISTRY["petroncini_traditional"]["default_params"]["channels"]}
    assert (traditional["BT"]["offset"], traditional["ET"]["offset"], traditional["BT"]["area"]) == (40, 42, 3)
    i06 = {c["role"]: c for c in ROASTER_REGISTRY["petroncini_maestro_i06"]["default_params"]["channels"]}
    assert (i06["BT"]["db"], i06["BT"]["offset"], i06["BT"]["type"], i06["BT"]["area"]) == (31, 0, 1, 6)
    assert (i06["ET"]["offset"], i06["gas"]["offset"]) == (8, 4)
    assert (i06["heater"]["offset"], i06["drum"]["offset"], i06["fan"]["offset"]) == (32, 34, 36)
    assert i06["heater"]["unit"] == "%"


def test_toper_plc_input1_is_bt() -> None:
    """Toper/PLC.aset: input1=BT register 0, input2=ET register 2, holding, ÷10.

    PLC_Control(2025+ 쓰기)와 USB.aset(RTU)은 이 키가 아니다.
    """
    entry = ROASTER_REGISTRY["toper_plc"]
    regs = entry["default_params"]["modbus_registers"]
    assert entry["capabilities"] == []
    assert entry["default_params"]["mode"] == "tcp"
    assert entry["default_params"]["host"] == "192.168.137.90"
    assert regs["BT"]["register"] == 0
    assert regs["ET"]["register"] == 2
    for role in ("BT", "ET"):
        assert regs[role]["func"] == 3
        assert regs[role]["div"] == 1
        assert regs[role]["unit_id"] == 1
        assert regs[role]["float"] is False


_LORING_READ = {
    "BT": {"register": 768, "func": 3, "bcd": True, "bcd_as_int": False, "div": 1, "mode": "F"},
    "ET": {"register": 774, "func": 3, "bcd": True, "bcd_as_int": False, "div": 1, "mode": "F"},
    "inlet": {"register": 770, "func": 3, "bcd": True, "bcd_as_int": False, "div": 1, "mode": "F"},
    "stack": {"register": 772, "func": 3, "bcd": True, "bcd_as_int": False, "div": 1, "mode": "F"},
    "heater": {"register": 778, "func": 3, "bcd": False, "bcd_as_int": True, "div": 0, "mode": ""},
}


def test_loring_registers_match_artisan_aset() -> None:
    """Smart_Roast.aset / Smart_Roast_Auto.aset 읽기 맵. 778은 Burner, 쓰기는 없다."""
    for key in ("loring_smart_roast", "loring_smart_roast_auto"):
        entry = ROASTER_REGISTRY[key]
        regs = entry["default_params"]["modbus_registers"]
        assert entry["protocol"] == "modbus"
        assert entry["default_params"]["host"] == "192.168.1.199"
        assert entry["default_params"]["port"] == 502
        assert "write_map" not in entry["default_params"]
        assert "drum" not in regs
        assert entry["capabilities"] == ["heater"]
        for role, expect in _LORING_READ.items():
            got = regs[role]
            for field, value in expect.items():
                assert got.get(field, False if field == "bcd_as_int" else None) == value, f"{key}.{role}.{field}"
            assert got["unit_id"] == 1
    auto = ROASTER_REGISTRY["loring_smart_roast_auto"]["default_params"]["modbus_registers"]
    assert auto["auto_status"] == {
        "register": 284,
        "func": 2,
        "unit_id": 1,
        "float": False,
        "bcd": False,
        "div": 0,
        "mode": "",
    }
    assert "auto_status" not in ROASTER_REGISTRY["loring_smart_roast"]["default_params"]["modbus_registers"]

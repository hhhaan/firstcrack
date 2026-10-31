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

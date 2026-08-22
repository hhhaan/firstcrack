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


def test_loring_778_is_heater_not_drum() -> None:
    """Smart_Roast.aset: input3=778은 {3}=Burner — heater role이 맞다."""
    for key in ("loring_smart_roast", "loring_smart_roast_auto"):
        regs = ROASTER_REGISTRY[key]["default_params"]["modbus_registers"]
        assert "drum" not in regs
        assert regs["heater"]["register"] == 778
        assert ROASTER_REGISTRY[key]["capabilities"] == ["heater"]

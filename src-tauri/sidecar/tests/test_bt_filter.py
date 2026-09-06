"""bt_filter — 프론트 createBtFilter 계약과 동일."""

from bt_filter import create_bt_filter

T0 = 1_000_000


def s(sec: float) -> float:
    return T0 + sec * 1000


class TestBtFilter:
    def test_normal_curve_passes(self):
        f = create_bt_filter()
        assert f(180, s(0)) == 180
        assert f(178.5, s(1)) == 178.5
        assert f(177.2, s(2)) == 177.2

    def test_out_of_range_rejected(self):
        f = create_bt_filter()
        assert f(200, s(0)) == 200
        assert f(0, s(1)) is None
        assert f(-5, s(2)) is None
        assert f(1372, s(3)) is None
        assert f(float("nan"), s(4)) is None
        assert f(199, s(5)) == 199

    def test_single_spike_rejected_then_recovery(self):
        f = create_bt_filter()
        f(190, s(0))
        assert f(120, s(1)) is None
        assert f(189, s(2)) == 189

    def test_charge_drop_passes(self):
        f = create_bt_filter()
        f(200, s(0))
        assert f(192, s(1)) == 192
        assert f(184, s(2)) == 184
        assert f(177, s(3)) == 177

    def test_two_step_change_accepted(self):
        f = create_bt_filter()
        f(200, s(0))
        assert f(150, s(1)) is None
        assert f(149, s(2)) == 149
        assert f(148, s(3)) == 148

    def test_long_gap_allows_jump(self):
        f = create_bt_filter()
        f(220, s(0))
        assert f(100, s(30)) == 100

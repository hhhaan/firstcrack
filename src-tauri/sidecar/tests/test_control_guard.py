"""control_guard 순수 함수 테스트 — 제어 명령의 신뢰 경계."""

import pytest

from control_guard import (
    ControlRangeError,
    clamp_command,
    parse_command,
)


WRITE_MAP = {
    "heater": {"min": 0, "max": 100, "unit": "%"},
    "fan": {"min": 0, "max": 280},
}


class TestParseCommand:
    def test_empty_body_is_noop(self):
        assert parse_command({}) == {}

    def test_ignores_unknown_keys(self):
        assert parse_command({"pressure": 120, "heater": 50}) == {"heater": 50.0}

    def test_normalizes_int_and_numeric_string(self):
        assert parse_command({"heater": 50, "fan": "60.5"}) == {"heater": 50.0, "fan": 60.5}

    def test_null_role_is_skipped(self):
        assert parse_command({"heater": None, "fan": 30}) == {"fan": 30.0}

    @pytest.mark.parametrize("bad", ["abc", [], {}, object()])
    def test_rejects_non_numeric(self, bad):
        with pytest.raises(ControlRangeError):
            parse_command({"heater": bad})

    def test_rejects_bool(self):
        """True는 float()이 1.0으로 받아버린다 — 화력 1%를 의도한 요청이 아니다."""
        with pytest.raises(ControlRangeError):
            parse_command({"heater": True})

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_rejects_non_finite(self, bad):
        with pytest.raises(ControlRangeError):
            parse_command({"heater": bad})

    def test_out_of_range_is_not_rejected_here(self):
        """범위 초과는 거부가 아니라 클램프 — 형식 검증만 담당한다."""
        assert parse_command({"heater": 500}) == {"heater": 500.0}


class TestClampCommand:
    def test_clamps_above_max(self):
        assert clamp_command({"heater": 150.0}, WRITE_MAP) == {"heater": 100.0}

    def test_clamps_below_min(self):
        assert clamp_command({"heater": -20.0}, WRITE_MAP) == {"heater": 0.0}

    def test_passes_in_range_untouched(self):
        assert clamp_command({"heater": 63.5}, WRITE_MAP) == {"heater": 63.5}

    def test_uses_per_role_limits(self):
        assert clamp_command({"fan": 250.0}, WRITE_MAP) == {"fan": 250.0}
        assert clamp_command({"fan": 300.0}, WRITE_MAP) == {"fan": 280.0}

    def test_no_limits_means_no_clamp(self):
        assert clamp_command({"heater": 999.0}, {"heater": {}}) == {"heater": 999.0}

"""Reference trust boundary and the identical live/reference numerical path."""

from copy import deepcopy
from dataclasses import FrozenInstanceError, asdict, replace
import math

import pytest

from roast_target import (
    MachineIdentity, RawObservation, RawTpState, TargetValidationError, VIRTUAL_CONFIG,
    advance_filter, advance_tp, parse_clock, parse_machine, parse_processing, parse_target,
)


CLOCK = "a" * 32 + ":1"
MACHINE = MachineIdentity("virtual-fixture", "virtual", "virtual")
PROCESSING = {
    "algorithm_version": "ema-least-squares-v1",
    "temperature_unit": "C", "ror_unit": "C/min",
    "timestamp_clock": "sidecar-monotonic-seconds",
    "display_ema_alpha": 0.25, "ror_ema_alpha": 0.15,
    "ror_window_sec": 30, "ror_warmup_reads": 5,
}


def observation(t, bt, *, acquired_at=None, clock=CLOCK):
    return RawObservation(clock, 1000 + t if acquired_at is None else acquired_at, t, bt)


def reference(*, count=61, cadence=1.0, first=0.0, drop=None):
    points = []
    for index in range(count):
        t = first + index * cadence
        bt = 150 - t if t <= 25 else min(240, 125 + (t - 25) * 0.5)
        points.append({"elapsed_sec": t, "acquired_at": 1000 + t,
                       "sensor_clock": CLOCK, "bt_c": bt, "processing": deepcopy(PROCESSING)})
    return {"version": "raw-bt-reference-v1", "source": "recorded_session",
            "source_session_id": "recorded-fixture", "source_machine": asdict(MACHINE),
            "temperature_unit": "C", "control_filter_version": "raw-bt-dt-ema-v1",
            "charge": {"event_id": "charge-event", "elapsed_sec": 0},
            "drop": {"event_id": "drop-event", "elapsed_sec": points[-1]["elapsed_sec"] if drop is None else drop},
            "points": points}


def parse(value):
    return parse_target(value, machine=MACHINE, config=VIRTUAL_CONFIG)


def test_reference_is_frozen_and_matches_live_filter_tp_and_interpolation():
    source = reference()
    target = parse(source)
    control_filter, tp = None, RawTpState()
    for sample, expected in zip(target.points, target.filtered):
        control_filter = advance_filter(control_filter, sample)
        tp = advance_tp(tp, sample)
        assert control_filter.value == expected
        assert target.at(sample.elapsed_sec) == expected
    assert target.tp == tp.qualified
    assert target.tp.minimum_elapsed_sec == 25
    assert target.tp.confirmed_elapsed_sec == 34
    assert target.at(40.5) == pytest.approx((target.filtered[40] + target.filtered[41]) / 2)
    source["points"][40]["bt_c"] = 0
    source["source_machine"]["machine_id"] = "mutated"
    assert target.points[40].bt_c == 132.5
    assert target.source_machine == MACHINE
    with pytest.raises(FrozenInstanceError):
        target.end_sec = 1


def test_digest_is_canonical_and_covers_provenance():
    original = reference()
    reversed_keys = {key: original[key] for key in reversed(original)}
    assert parse(original).digest == parse(reversed_keys).digest
    reversed_keys = deepcopy(original)
    reversed_keys["points"][0]["bt_c"] = 150
    assert parse(original).digest == parse(reversed_keys).digest
    for mutate in (
        lambda value: value.update(source_session_id="other"),
        lambda value: value["charge"].update(event_id="other"),
        lambda value: value["drop"].update(event_id="other"),
        lambda value: value["points"][10].update(bt_c=140.1),
        lambda value: value["points"][10]["processing"].update(display_ema_alpha=0.5),
    ):
        changed = deepcopy(original)
        mutate(changed)
        assert parse(original).digest != parse(changed).digest
    assert parse_target(original, machine=MACHINE,
                        config=replace(VIRTUAL_CONFIG, config_id="future-version")).digest != parse(original).digest


@pytest.mark.parametrize("field,bad", [
    ("source", "synthetic"), ("version", "legacy"), ("temperature_unit", "F"),
    ("control_filter_version", "display-ema"), ("source_session_id", ""),
    ("source_session_id", "x" * 129), ("source_session_id", True), ("unknown", 1),
    ("points", []), ("points", [None] * 10001),
])
def test_rejects_invalid_reference_envelope(field, bad):
    value = reference()
    value[field] = bad
    with pytest.raises(TargetValidationError):
        parse(value)


@pytest.mark.parametrize("bad", [None, True, "1", math.nan, math.inf, -math.inf, 10**400])
@pytest.mark.parametrize("field", ["elapsed_sec", "acquired_at", "bt_c"])
def test_rejects_invalid_point_numbers(field, bad):
    value = reference()
    value["points"][30][field] = bad
    with pytest.raises(TargetValidationError):
        parse(value)


@pytest.mark.parametrize("field", ["elapsed_sec", "acquired_at", "sensor_clock", "bt_c", "processing"])
def test_missing_point_provenance_is_not_repaired(field):
    value = reference()
    del value["points"][0][field]
    with pytest.raises(TargetValidationError):
        parse(value)


@pytest.mark.parametrize("mutation", [
    lambda v: v["points"][20].update(elapsed_sec=19),
    lambda v: v["points"][20].update(acquired_at=1019),
    lambda v: v["points"][20].update(acquired_at=1018),
    lambda v: v["points"][20].update(sensor_clock="b" * 32 + ":1"),
    lambda v: v["points"][20].update(bt_c=-0.1),
    lambda v: v["points"][20].update(bt_c=260.1),
    lambda v: v["points"][20].update(extra=1),
    lambda v: v["points"][20]["processing"].update(extra=1),
    lambda v: v["charge"].update(elapsed_sec=True),
    lambda v: v["charge"].update(elapsed_sec=1),
    lambda v: v["drop"].update(elapsed_sec=0),
    lambda v: v["drop"].update(elapsed_sec=1801),
    lambda v: v["drop"].update(elapsed_sec=59),
    lambda v: v["drop"].update(elapsed_sec=63.01),
    lambda v: v["charge"].update(extra=1),
    lambda v: v["source_machine"].update(machine_id="wrong"),
    lambda v: v["source_machine"].update(extra=1),
])
def test_rejects_bad_timeline_units_identity_and_unknown_metadata(mutation):
    value = reference()
    mutation(value)
    with pytest.raises(TargetValidationError):
        parse(value)


@pytest.mark.parametrize("field", ["elapsed_sec", "acquired_at"])
def test_gaps_over_three_seconds_are_rejected_in_both_domains(field):
    value = reference(cadence=3, count=21)
    value["points"][10][field] += 0.01
    with pytest.raises(TargetValidationError):
        parse(value)


def test_origin_jitter_is_bounded_and_not_retimed():
    value = reference()
    for index, point in enumerate(value["points"]):
        point["acquired_at"] += index / 60
    target = parse(value)
    assert target.points[-1].acquired_at == 1061
    value["points"][-1]["acquired_at"] += 0.001
    with pytest.raises(TargetValidationError):
        parse(value)


def test_unsampled_charge_and_drop_never_create_measurements():
    value = reference(first=3, count=58, drop=63)
    target = parse(value)
    assert target.points[0].elapsed_sec == 3
    assert target.drop_sec == 63 and target.end_sec == 60
    assert target.at(60) == target.filtered[-1]
    for t in (0, 2.99, 60.001, 63, True, math.nan):
        with pytest.raises(TargetValidationError):
            target.at(t)
    with pytest.raises(TargetValidationError):
        parse(reference(first=3.001))


def test_chart_only_seed_and_unqualified_or_out_of_range_future_are_rejected():
    value = reference()
    value["points"][0].update(acquired_at=None, sensor_clock=None)
    with pytest.raises(TargetValidationError):
        parse(value)
    for mode in ("no_tp", "too_hot", "too_cold"):
        value = reference(count=120)
        for point in value["points"]:
            if mode == "no_tp":
                point["bt_c"] = 150
            elif point["elapsed_sec"] > 60:
                point["bt_c"] = 260 if mode == "too_hot" else 0
        with pytest.raises(TargetValidationError):
            parse(value)


def test_maximum_reference_and_two_decimal_elapsed_rounding():
    value = reference(count=10000, cadence=0.18)
    for point in value["points"]:
        point["elapsed_sec"] = round(point["elapsed_sec"], 2)
    target = parse(value)
    assert len(target.points) == 10000
    assert math.isfinite(target.at(1000.123))


@pytest.mark.parametrize("clock", ["", "a:1", "a" * 32, "a" * 32 + ":-1", "a" * 32 + ":01", "a" * 32 + ":1\n"])
def test_strict_clock(clock):
    with pytest.raises(TargetValidationError):
        parse_clock(clock)


def test_processing_optional_fields_and_nested_units_are_copied():
    value = {**PROCESSING, "et_display_ema_alpha": 0.3, "et_ror_ema_alpha": 0.2,
             "read_units": {"heater": "%", "fan": "Pa"}}
    parsed = parse_processing(value)
    value["read_units"]["heater"] = "RPM"
    assert parsed["read_units"]["heater"] == "%"
    assert parse_machine(asdict(MACHINE)) == MACHINE


@pytest.mark.parametrize("field,bad", [
    ("algorithm_version", "future"), ("temperature_unit", "F"), ("ror_unit", "F/min"),
    ("timestamp_clock", "wall"), ("display_ema_alpha", True), ("ror_ema_alpha", 1.1),
    ("et_display_ema_alpha", -0.1), ("ror_window_sec", 0), ("ror_warmup_reads", 0),
    ("ror_warmup_reads", 1.5), ("read_units", {"heater": None}),
    ("read_units", {"other": "%"}),
])
def test_processing_rejects_unrecognized_or_invalid_settings(field, bad):
    with pytest.raises(TargetValidationError):
        parse_processing({**PROCESSING, field: bad})


def test_filter_irregular_cadence_duplicate_and_gap_reset():
    state = advance_filter(None, observation(2, 150))
    assert state.value == 150 and state.warmup_remaining_sec == 10
    expected = 150
    previous = 2
    for t in (2.2, 3.5, 6, 9, 12):
        expected += (1 - math.exp(-(t - previous) / 2)) * (140 - expected)
        state = advance_filter(state, observation(t, 140))
        assert state.value == pytest.approx(expected)
        previous = t
    assert state.warmup_remaining_sec == 0
    assert advance_filter(state, observation(12, 999)) is state
    state = advance_filter(state, observation(15.01, 130))
    assert state.value == 130 and state.warmup_remaining_sec == 10
    with pytest.raises(TargetValidationError):
        advance_filter(state, observation(14, 130))
    with pytest.raises(TargetValidationError):
        advance_filter(state, observation(16, 130, clock="b" * 32 + ":1"))


def test_filter_and_tp_duration_use_acquisition_time_without_rounding():
    state = advance_filter(None, observation(0, 150))
    state = advance_filter(state, observation(1, 140, acquired_at=1000.5))
    assert state.value == pytest.approx(150 + (1 - math.exp(-0.5 / 2)) * -10)
    assert state.warmup_remaining_sec == 9.5
    tp = tp_preparation()
    for t in range(26, 32):
        tp = advance_tp(tp, observation(t, 127, acquired_at=1025 + (t - 25) * 0.5))
    assert tp.qualified is None
    for t in range(32, 37):
        tp = advance_tp(tp, observation(t, 127, acquired_at=1025 + (t - 25) * 0.5))
    assert tp.qualified.confirmed_elapsed_sec == 36


def tp_preparation():
    state = RawTpState()
    for t in range(26):
        state = advance_tp(state, observation(t, 150 - t))
    return state


def test_tp_equal_minimum_plateau_uses_latest_time_and_raw_recovery_duration():
    state = tp_preparation()
    for t in range(26, 31):
        state = advance_tp(state, observation(t, 125))
    for t in range(31, 36):
        state = advance_tp(state, observation(t, 127))
        assert state.qualified is None
    assert advance_tp(state, observation(35, 999)) is state
    state = advance_tp(state, observation(36, 127))
    assert state.qualified.minimum_elapsed_sec == 30
    assert state.qualified.confirmed_elapsed_sec == 36


def test_tp_recovery_dip_and_lower_minimum_restart_duration():
    state = tp_preparation()
    for t, bt in ((26, 127), (28, 127), (30, 126.9), (31, 127), (33, 127), (35, 127)):
        state = advance_tp(state, observation(t, bt))
        assert state.qualified is None
    state = advance_tp(state, observation(36, 124))
    for t in range(37, 43):
        state = advance_tp(state, observation(t, 126))
    assert state.qualified.minimum_elapsed_sec == 36
    assert state.qualified.confirmed_elapsed_sec == 42


def test_gap_resets_unconfirmed_tp_but_keeps_confirmed_history():
    state = tp_preparation()
    reset = advance_tp(state, observation(29, 130))
    assert reset.minimum.elapsed_sec == 29 and reset.baseline == 130
    for t in range(26, 32):
        state = advance_tp(state, observation(t, 127))
    assert state.qualified is not None
    assert advance_tp(state, observation(40, 100)).qualified == state.qualified
    with pytest.raises(TargetValidationError):
        advance_tp(state, observation(40, 100, clock="b" * 32 + ":1"))


@pytest.mark.parametrize("descent,minimum_at", [(4.99, 25), (10, 19)])
def test_tp_requires_real_descent_and_minimum_at_twenty_seconds(descent, minimum_at):
    state = RawTpState()
    for t in range(100):
        bt = 150 - descent * t / minimum_at if t <= minimum_at else 150 - descent + 2
        state = advance_tp(state, observation(t, bt))
    assert state.qualified is None

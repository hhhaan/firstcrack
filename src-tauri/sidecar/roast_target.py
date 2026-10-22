"""Validated recorded raw BT, shared control filtering, and raw TP evidence."""

from bisect import bisect_left
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import re


class TargetValidationError(ValueError):
    def __init__(self, message: str, *, field: str | None = None,
                 code: str = "invalid_reference") -> None:
        super().__init__(message)
        self.field = field
        self.code = code


@dataclass(frozen=True)
class MachineIdentity:
    machine_id: str
    roaster_key: str
    protocol: str


@dataclass(frozen=True)
class CurveConfig:
    config_id: str = "virtual-v1"
    kp: float = 4.0
    ki: float = 0.3
    kd: float = 2.0
    out_min: float = 0.0
    out_max: float = 100.0
    slew_per_sec: float = 5.0
    lease_sec: float = 3.0
    initial_error_c: float = 10.0
    control_filter_version: str = "raw-bt-dt-ema-v1"


VIRTUAL_CONFIG = CurveConfig()


@dataclass(frozen=True)
class RawObservation:
    clock: str
    acquired_at: float
    elapsed_sec: float
    bt_c: float


@dataclass(frozen=True)
class QualifiedTp:
    minimum_elapsed_sec: float
    confirmed_elapsed_sec: float
    minimum_bt_c: float


@dataclass(frozen=True)
class ControlFilter:
    value: float
    seed_at: float
    sample: RawObservation

    @property
    def warmup_remaining_sec(self) -> float:
        return max(0.0, 10.0 - (self.sample.acquired_at - self.seed_at))


@dataclass(frozen=True)
class RawTpState:
    baseline: float | None = None
    minimum: RawObservation | None = None
    recovery_at: float | None = None
    sample: RawObservation | None = None
    qualified: QualifiedTp | None = None


def _advance_dt(previous: RawObservation, sample: RawObservation) -> float:
    if sample.clock != previous.clock:
        raise TargetValidationError("Observation clock changed", field="sensor_clock")
    dt = sample.acquired_at - previous.acquired_at
    if dt == 0:
        return 0.0
    if dt < 0 or sample.elapsed_sec <= previous.elapsed_sec:
        raise TargetValidationError("Observation times must increase", field="acquired_at")
    return dt


def advance_filter(state: ControlFilter | None, sample: RawObservation) -> ControlFilter:
    if state is None:
        return ControlFilter(sample.bt_c, sample.acquired_at, sample)
    dt = _advance_dt(state.sample, sample)
    if dt == 0:
        return state
    if dt > 3:
        return ControlFilter(sample.bt_c, sample.acquired_at, sample)
    value = state.value + -math.expm1(-dt / 2.0) * (sample.bt_c - state.value)
    return ControlFilter(value, state.seed_at, sample)


def advance_tp(state: RawTpState, sample: RawObservation) -> RawTpState:
    if state.sample is not None:
        dt = _advance_dt(state.sample, sample)
        if dt == 0:
            return state
        if state.qualified is not None:
            return RawTpState(state.baseline, state.minimum, state.recovery_at,
                              sample, state.qualified)
        if dt > 3:
            state = RawTpState()
    if state.minimum is None:
        return RawTpState(sample.bt_c, sample, sample=sample)
    minimum = state.minimum
    if sample.bt_c <= minimum.bt_c:
        return RawTpState(state.baseline, sample, sample=sample)
    if (state.baseline - minimum.bt_c < 5 or minimum.elapsed_sec < 20
            or sample.bt_c < minimum.bt_c + 2):
        return RawTpState(state.baseline, minimum, sample=sample)
    recovery_at = state.recovery_at if state.recovery_at is not None else sample.acquired_at
    qualified = None
    if sample.acquired_at - recovery_at >= 5:
        qualified = QualifiedTp(minimum.elapsed_sec, sample.elapsed_sec, minimum.bt_c)
    return RawTpState(state.baseline, minimum, recovery_at, sample, qualified)


@dataclass(frozen=True)
class RoastTarget:
    digest: str
    source_session_id: str
    source_machine: MachineIdentity
    points: tuple[RawObservation, ...]
    filtered: tuple[float, ...]
    tp: QualifiedTp
    drop_sec: float
    end_sec: float

    def at(self, elapsed_sec: float) -> float:
        elapsed_sec = _number(elapsed_sec, "elapsed_sec")
        if not self.points[0].elapsed_sec <= elapsed_sec <= self.end_sec:
            raise TargetValidationError("Target time outside recorded support", field="elapsed_sec")
        index = bisect_left(self.points, elapsed_sec, key=lambda point: point.elapsed_sec)
        if self.points[index].elapsed_sec == elapsed_sec:
            return self.filtered[index]
        left, right = self.points[index - 1], self.points[index]
        fraction = (elapsed_sec - left.elapsed_sec) / (right.elapsed_sec - left.elapsed_sec)
        return self.filtered[index - 1] + fraction * (self.filtered[index] - self.filtered[index - 1])


def _object(value: object, required: set[str], field: str,
            optional: set[str] | None = None) -> dict:
    if not isinstance(value, dict) or set(value) - required - (optional or set()) or required - set(value):
        raise TargetValidationError("Missing or unknown fields", field=field)
    return value


def _string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise TargetValidationError("Expected a nonempty string of at most 128 characters", field=field)
    return value


def _number(value: object, field: str, minimum: float = -math.inf,
            maximum: float = math.inf) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TargetValidationError("Expected a finite number", field=field)
    try:
        number = float(value)
    except OverflowError as error:
        raise TargetValidationError("Expected a finite number", field=field) from error
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise TargetValidationError("Number outside permitted range", field=field)
    return 0.0 if number == 0 else number


def parse_clock(value: object, field: str = "sensor_clock") -> str:
    clock = _string(value, field)
    if re.fullmatch(r"[0-9a-fA-F]{32}:(?:0|[1-9][0-9]*)", clock) is None:
        raise TargetValidationError("Invalid sensor clock", field=field)
    return clock


def parse_machine(value: object, field: str = "machine") -> MachineIdentity:
    data = _object(value, {"machine_id", "roaster_key", "protocol"}, field)
    return MachineIdentity(*(_string(data[key], f"{field}.{key}")
                             for key in ("machine_id", "roaster_key", "protocol")))


def parse_processing(value: object, field: str = "processing") -> dict:
    required = {"algorithm_version", "temperature_unit", "ror_unit", "timestamp_clock",
                "display_ema_alpha", "ror_ema_alpha", "ror_window_sec", "ror_warmup_reads"}
    data = _object(value, required, field,
                   {"read_units", "et_display_ema_alpha", "et_ror_ema_alpha"})
    normalized = {}
    for key, expected in (("algorithm_version", "ema-least-squares-v1"),
                          ("temperature_unit", "C"), ("ror_unit", "C/min"),
                          ("timestamp_clock", "sidecar-monotonic-seconds")):
        if data[key] != expected:
            raise TargetValidationError("Unsupported processing metadata", field=f"{field}.{key}")
        normalized[key] = expected
    for key in ("display_ema_alpha", "ror_ema_alpha", "et_display_ema_alpha", "et_ror_ema_alpha"):
        if key in data:
            normalized[key] = _number(data[key], f"{field}.{key}", 0, 1)
    window = _number(data["ror_window_sec"], f"{field}.ror_window_sec")
    warmup = _number(data["ror_warmup_reads"], f"{field}.ror_warmup_reads")
    if window <= 0 or warmup < 1 or not warmup.is_integer():
        raise TargetValidationError("Invalid RoR window or warmup", field=field)
    normalized.update(ror_window_sec=window, ror_warmup_reads=int(warmup))
    if "read_units" in data:
        units = _object(data["read_units"], set(), f"{field}.read_units", {"heater", "fan", "drum"})
        if any(not isinstance(unit, str) or unit not in {"%", "Pa", "Hz", "RPM"} for unit in units.values()):
            raise TargetValidationError("Unsupported read units", field=f"{field}.read_units")
        normalized["read_units"] = dict(units)
    return normalized


def parse_target(value: object, *, machine: MachineIdentity, config: CurveConfig) -> RoastTarget:
    data = _object(value, {"version", "source", "source_session_id", "source_machine",
                           "temperature_unit", "control_filter_version", "charge", "drop", "points"},
                   "reference")
    for key, expected in (("version", "raw-bt-reference-v1"), ("source", "recorded_session"),
                          ("temperature_unit", "C"), ("control_filter_version", config.control_filter_version)):
        if data[key] != expected:
            raise TargetValidationError("Unsupported reference format", field=f"reference.{key}")
    source_session_id = _string(data["source_session_id"], "reference.source_session_id")
    source_machine = parse_machine(data["source_machine"], "reference.source_machine")
    if source_machine != machine:
        raise TargetValidationError("Source machine differs from connected machine",
                                    field="reference.source_machine", code="machine_mismatch")
    events = {}
    for key in ("charge", "drop"):
        event = _object(data[key], {"event_id", "elapsed_sec"}, f"reference.{key}")
        events[key] = {"event_id": _string(event["event_id"], f"reference.{key}.event_id"),
                       "elapsed_sec": _number(event["elapsed_sec"], f"reference.{key}.elapsed_sec", 0, 1800)}
    drop = events["drop"]["elapsed_sec"]
    if events["charge"]["elapsed_sec"] != 0 or drop <= 0:
        raise TargetValidationError("Reference requires Charge zero and positive Drop", field="reference")
    if not isinstance(data["points"], list) or not 10 <= len(data["points"]) <= 10000:
        raise TargetValidationError("Reference requires 10 to 10000 acquired points", field="reference.points")
    points: list[RawObservation] = []
    filtered: list[float] = []
    normalized_points = []
    control_filter = None
    tp_state = RawTpState()
    for index, value in enumerate(data["points"]):
        field = f"reference.points[{index}]"
        point = _object(value, {"elapsed_sec", "acquired_at", "sensor_clock", "bt_c", "processing"}, field)
        sample = RawObservation(parse_clock(point["sensor_clock"], f"{field}.sensor_clock"),
                                _number(point["acquired_at"], f"{field}.acquired_at"),
                                _number(point["elapsed_sec"], f"{field}.elapsed_sec", 0, drop),
                                _number(point["bt_c"], f"{field}.bt_c", 0, 260))
        processing = parse_processing(point["processing"], f"{field}.processing")
        if not points:
            if sample.elapsed_sec > 3:
                raise TargetValidationError("First acquired point is too late", field=field)
            origin = sample.acquired_at - sample.elapsed_sec
        else:
            previous = points[-1]
            if (sample.clock != previous.clock or not 0 < sample.acquired_at - previous.acquired_at <= 3
                    or not 0 < sample.elapsed_sec - previous.elapsed_sec <= 3):
                raise TargetValidationError("Clock, ordering, or acquisition gap is invalid", field=field)
            if abs(sample.acquired_at - sample.elapsed_sec - origin) > 1:
                raise TargetValidationError("Acquisition and elapsed timelines disagree", field=field)
        points.append(sample)
        control_filter = advance_filter(control_filter, sample)
        tp_state = advance_tp(tp_state, sample)
        filtered.append(control_filter.value)
        normalized_points.append({"sensor_clock": sample.clock, "acquired_at": sample.acquired_at,
                                  "elapsed_sec": sample.elapsed_sec, "bt_c": sample.bt_c,
                                  "processing": processing})
    if drop - points[-1].elapsed_sec > 3:
        raise TargetValidationError("Last acquired point is too far before Drop", field="reference.drop")
    if tp_state.qualified is None:
        raise TargetValidationError("Reference has no qualified raw TP", field="reference.points")
    for sample, temperature in zip(points, filtered):
        if sample.elapsed_sec >= tp_state.qualified.confirmed_elapsed_sec and not 50 <= temperature <= 250:
            raise TargetValidationError("Qualified target outside fixed PID range", field="reference.points")
    normalized = {**data, "source_session_id": source_session_id, "source_machine": asdict(source_machine),
                  **events, "points": normalized_points}
    digest = hashlib.sha256(json.dumps({"config_id": config.config_id, "reference": normalized},
                                      sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    return RoastTarget(digest, source_session_id, source_machine, tuple(points), tuple(filtered),
                       tp_state.qualified, drop, points[-1].elapsed_sec)

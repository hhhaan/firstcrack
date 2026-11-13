"""Bounded failure groups and connection incident facts, without device addresses."""
from collections.abc import Iterator
from dataclasses import dataclass, field
import errno
import time
from typing import Any
import uuid


class SensorReadError(RuntimeError):
    """The required BT channel returned an invalid measurement or sentinel."""


def exception_chain(exc: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    for _ in range(8):
        if id(exc) in seen:
            break
        seen.add(id(exc))
        yield exc
        exc = exc.__cause__ or exc.__context__
        if exc is None:
            break


def s7_diagnostics(exc: BaseException) -> dict[str, Any]:
    return next((facts for cause in exception_chain(exc)
                 if isinstance(facts := getattr(cause, "s7_diagnostics", None), dict)), {})


_STAGES = frozenset({
    "tcp_probe", "client_create", "configure", "connect", "connection_state",
    "cpu_state", "lock", "read", "read_budget", "decode", "write", "readback",
    "validate_bt", "control", "reset", "unknown",
})
_REASONS = frozenset({
    "timeout", "connection_reset", "connection_refused", "unreachable",
    "address_range", "function_refused", "receive_failure", "send_failure",
    "invalid_bt", "invalid_data", "cpu_not_running", "disconnected",
    "lock_timeout", "readback_mismatch", "io_error", "unknown",
})
_PROTOCOLS = frozenset({"s7", "modbus", "phidget", "kaleido", "probat_ws", "virtual"})


def failure_tags(exc: BaseException, event: str) -> dict[str, str]:
    """Describe observed failure, never infer a physical cable/network/sensor cause."""
    chain = list(exception_chain(exc))
    if any(isinstance(cause, SensorReadError) for cause in chain):
        return {"failure_stage": "validate_bt", "failure_reason": "invalid_bt"}
    facts = s7_diagnostics(exc)
    first = facts.get("first_failure") or {}
    stage = first.get("stage") or facts.get("stage")
    if stage not in _STAGES:
        stage = next((stage for keyword, stage in (
            ("read", "read"), ("connect", "connect"), ("control", "control"),
            ("pid", "control"), ("reset", "reset"),
        ) if keyword in event), "unknown")
    reason = first.get("error_code")
    if reason not in _REASONS or reason == "unknown":
        reason = "unknown"
        for cause in chain:
            message = str(cause).lower()
            if isinstance(cause, TimeoutError) or "timeout" in message or "timed out" in message:
                reason = "timeout"
            elif isinstance(cause, ConnectionRefusedError) or "connection refused" in message:
                reason = "connection_refused"
            elif isinstance(cause, (ConnectionResetError, BrokenPipeError)) or "connection reset" in message or "reset by peer" in message:
                reason = "connection_reset"
            elif getattr(cause, "errno", None) in (errno.ENETUNREACH, errno.EHOSTUNREACH) or "unreachable" in message:
                reason = "unreachable"
            if reason != "unknown":
                break
        if reason == "unknown":
            # An outer generic ConnectionError must not hide an inner timeout.
            reason = next((code for error_type, code in (
                (ConnectionError, "disconnected"), (ValueError, "invalid_data"),
                (OSError, "io_error"),
            ) if any(isinstance(cause, error_type) for cause in chain)), "unknown")
    if first.get("outcome") == "not_acquired" or (stage == "lock" and reason == "timeout"):
        reason = "lock_timeout"
    elif facts.get("readback_matched") is False and reason in {"unknown", "io_error"}:
        reason = "readback_mismatch"
    elif facts.get("cpu_validation") == "not_run" and not first:
        reason = "cpu_not_running"
    return {"failure_stage": stage, "failure_reason": reason}


def hardware_fingerprint(event: str, tags: dict[str, str]) -> list[str]:
    # Only bounded values enter grouping. Never use raw exception text, hosts, or IDs.
    return ["hardware", event,
            tags.get("protocol") if tags.get("protocol") in _PROTOCOLS else "unknown",
            tags.get("failure_stage") if tags.get("failure_stage") in _STAGES else "unknown",
            tags.get("failure_reason") if tags.get("failure_reason") in _REASONS else "unknown"]


@dataclass
class ConnectionIncident:
    initial_event: str
    initial_stage: str
    initial_reason: str
    incident_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: float = field(default_factory=time.monotonic)
    reconnect_attempts: int = 0
    reconnect_failures: int = 0
    transport_restored_at: float | None = None

    def context(self) -> dict[str, Any]:
        return {
            "incident_id": self.incident_id,
            "initial_event": self.initial_event,
            "initial_stage": self.initial_stage,
            "initial_reason": self.initial_reason,
            "duration_ms": round(max(0, time.monotonic() - self.started_at) * 1000),
            "reconnect_attempts": self.reconnect_attempts,
            "reconnect_failures": self.reconnect_failures,
            "transport_restored_ms": None if self.transport_restored_at is None else round(
                max(0, self.transport_restored_at - self.started_at) * 1000),
        }

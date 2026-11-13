"""Sentry fingerprint helpers."""

import asyncio
import errno

import pytest

from hardware_diagnostics import failure_tags
from manager import SensorReadError, _hardware_sentry_fingerprint, _scrub_hardware_exception


def test_hardware_fingerprint_is_the_event():
    assert _hardware_sentry_fingerprint("control_write_failed", {}) == ["hardware", "control_write_failed", "unknown", "unknown", "unknown"]


def test_scrub_hardware_exception_redacts_host_port_and_keeps_traceback():
    try:
        raise ConnectionError("connect 10.0.0.2:1112 failed")
    except ConnectionError as exc:
        scrubbed = _scrub_hardware_exception(exc)
        assert str(scrubbed) == "connect [redacted] failed"
        assert scrubbed.__traceback__ is exc.__traceback__


def test_scrub_hardware_exception_scrubs_address_tuple():
    exc = ConnectionError("connect failed: ('[redacted]', 102)")
    scrubbed = _scrub_hardware_exception(exc)
    assert "102" not in str(scrubbed)
    assert "('[redacted]'" not in str(scrubbed)


def test_scrub_hardware_exception_scrubs_implicit_context_chain():
    try:
        try:
            raise OSError("refused 192.168.0.10:102")
        except OSError:
            raise ConnectionError("PLC write failed")
    except ConnectionError as exc:
        scrubbed = _scrub_hardware_exception(exc)
        assert scrubbed.__context__ is not None
        assert "192.168.0.10" not in str(scrubbed.__context__)
        assert ":102" not in str(scrubbed.__context__)


def test_scrub_hardware_exception_scrubs_chained_cause():
    try:
        try:
            raise OSError("refused 192.168.0.10:102")
        except OSError as cause:
            raise ConnectionError("PLC write failed") from cause
    except ConnectionError as exc:
        scrubbed = _scrub_hardware_exception(exc)
        assert str(scrubbed) == "PLC write failed"
        assert scrubbed.__cause__ is not None
        assert "192.168.0.10" not in str(scrubbed.__cause__)
        assert ":102" not in str(scrubbed.__cause__)


def test_distinct_hardware_fingerprints():
    control = _hardware_sentry_fingerprint("control_write_failed", {})
    pid = _hardware_sentry_fingerprint("pid_on_failed", {})
    assert control != pid


@pytest.mark.parametrize("error,reason", [
    (TimeoutError(), "timeout"),
    (RuntimeError("ISO : error during recv TCP : Connection timed out"), "timeout"),
    (ConnectionRefusedError(), "connection_refused"),
    (ConnectionResetError(), "connection_reset"),
    (OSError(errno.EHOSTUNREACH, "route failure"), "unreachable"),
    (ValueError("non-finite feedback"), "invalid_data"),
])
def test_observed_reason_is_bounded(error, reason):
    assert failure_tags(error, "read_failed_disconnected") == {
        "failure_stage": "read", "failure_reason": reason,
    }


def test_invalid_bt_tcp_read_and_tcp_probe_do_not_share_groups():
    bt = SensorReadError("BT 0")
    read = RuntimeError("TCP : Connection timed out")
    read.s7_diagnostics = {"stage": "cpu_state", "first_failure": {
        "stage": "read", "error_code": "timeout",
    }}
    probe = TimeoutError("timed out")
    probe.s7_diagnostics = {"stage": "tcp_probe"}
    groups = [tuple(_hardware_sentry_fingerprint("first_read_failed", {
        **failure_tags(error, "first_read_failed"), "protocol": "s7",
    })) for error in (bt, read, probe)]
    assert len(set(groups)) == 3
    assert groups[0][-2:] == ("validate_bt", "invalid_bt")
    assert groups[1][-2:] == ("read", "timeout")
    assert groups[2][-2:] == ("tcp_probe", "timeout")


def test_protocol_splits_groups_but_addresses_and_ids_do_not():
    tags = {"failure_stage": "read", "failure_reason": "timeout"}
    s7 = _hardware_sentry_fingerprint("first_read_failed", {**tags, "protocol": "s7"})
    modbus = _hardware_sentry_fingerprint("first_read_failed", {**tags, "protocol": "modbus"})
    assert s7 != modbus
    assert s7 == _hardware_sentry_fingerprint("first_read_failed", {
        **tags, "protocol": "s7", "host": "10.0.0.1", "incident_id": "unique",
    })
    assert _hardware_sentry_fingerprint("first_read_failed", {
        "protocol": "10.0.0.1", "failure_stage": "secret", "failure_reason": "COM3",
    })[-3:] == ["unknown"] * 3


def test_nested_diagnostics_survive_outer_timeout():
    inner = asyncio.CancelledError()
    inner.s7_diagnostics = {"stage": "read", "await_cancelled": True}
    outer = TimeoutError()
    outer.__cause__ = inner
    assert failure_tags(outer, "first_read_failed") == {
        "failure_stage": "read", "failure_reason": "timeout",
    }


def test_exception_cycles_are_bounded():
    error = ConnectionError("disconnected")
    error.__cause__ = error
    assert failure_tags(error, "connect_failed")["failure_reason"] == "disconnected"


def test_generic_wrapper_does_not_hide_timeout_cause():
    error = ConnectionError("PLC unavailable")
    error.__cause__ = TimeoutError()
    assert failure_tags(error, "connect_failed")["failure_reason"] == "timeout"


@pytest.mark.parametrize("facts,reason", [
    ({"stage": "cpu_state", "cpu_validation": "not_run"}, "cpu_not_running"),
    ({"stage": "lock", "first_failure": {"stage": "lock", "outcome": "not_acquired"}}, "lock_timeout"),
    ({"stage": "readback", "readback_matched": False}, "readback_mismatch"),
])
def test_s7_non_exception_outcomes_keep_their_reason(facts, reason):
    error = OSError("operation failed")
    error.s7_diagnostics = facts
    assert failure_tags(error, "connect_failed")["failure_reason"] == reason

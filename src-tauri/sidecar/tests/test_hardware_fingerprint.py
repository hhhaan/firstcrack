"""Sentry fingerprint helpers."""

from manager import _hardware_sentry_fingerprint, _scrub_hardware_exception


def test_hardware_fingerprint_is_the_event():
    assert _hardware_sentry_fingerprint("control_write_failed", {}) == ["hardware", "control_write_failed"]


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

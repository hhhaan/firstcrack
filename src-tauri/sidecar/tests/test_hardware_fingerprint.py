"""Sentry fingerprint helpers — distinct door events must not dedupe together."""

from manager import _hardware_sentry_fingerprint, _scrub_hardware_exception


def test_door_write_ambiguous_fingerprint():
    assert _hardware_sentry_fingerprint("door_write_ambiguous", {"door": "fill", "action": "open"}) == [
        "door_write_ambiguous",
        "fill",
        "open",
    ]


def test_hardware_door_502_fingerprint():
    assert _hardware_sentry_fingerprint("discharge", {"door": "discharge", "action": "close"}) == [
        "hardware",
        "discharge",
        "discharge",
    ]


def test_scrub_hardware_exception_redacts_host_port_and_keeps_traceback():
    try:
        raise ConnectionError("connect 10.0.0.2:1112 failed")
    except ConnectionError as exc:
        scrubbed = _scrub_hardware_exception(exc)
        assert str(scrubbed) == "connect [redacted] failed"
        assert scrubbed.__traceback__ is exc.__traceback__


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


def test_distinct_door_fingerprints():
    ambiguous = _hardware_sentry_fingerprint("door_write_ambiguous", {"door": "discharge", "action": "open"})
    write_fail = _hardware_sentry_fingerprint("fill", {"door": "fill", "action": "close"})
    assert ambiguous != write_fail

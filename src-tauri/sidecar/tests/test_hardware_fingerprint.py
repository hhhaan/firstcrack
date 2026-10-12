"""Sentry fingerprint helpers — distinct door events must not dedupe together."""

from manager import _hardware_sentry_fingerprint


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


def test_distinct_door_fingerprints():
    ambiguous = _hardware_sentry_fingerprint("door_write_ambiguous", {"door": "discharge", "action": "open"})
    write_fail = _hardware_sentry_fingerprint("fill", {"door": "fill", "action": "close"})
    assert ambiguous != write_fail

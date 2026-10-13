"""502 handlers must not double-report via LoggingIntegration (#773)."""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import sentry_sdk
from aiohttp.test_utils import TestClient, TestServer
from sentry_sdk.integrations.logging import LoggingIntegration

from main import create_app
from tests.conftest import FakeAdapter, make_reading


class _CapturingTransport(sentry_sdk.Transport):
    def __init__(self) -> None:
        self.events: list[dict] = []

    def capture_envelope(self, envelope) -> None:  # type: ignore[no-untyped-def]
        for item in envelope.items:
            if item.type == "event":
                self.events.append(item.payload.json)


def _exception_value(event: dict) -> str:
    values = (event.get("exception") or {}).get("values") or []
    assert values, "expected exception on Sentry event"
    return values[0].get("value") or ""


@pytest.fixture
def sentry_transport():
    client = sentry_sdk.get_client()
    if client is not None:
        client.close()
    transport = _CapturingTransport()
    sentry_sdk.init(
        dsn="https://public@example.com/123",
        integrations=[LoggingIntegration(event_level=logging.ERROR)],
        transport=transport,
        before_send=lambda event, _hint: event,
    )
    logging.getLogger("main").setLevel(logging.INFO)
    yield transport
    sentry_sdk.get_client().close()


@pytest.fixture
async def http_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_control_502_emits_one_tagged_sentry_event(http_client, sentry_transport):
    fake = FakeAdapter(readings=[make_reading(bt=150.0)])

    async def fail_control(**_kwargs):
        raise ConnectionError("PLC 10.0.0.2 write failed")

    fake.control = fail_control  # type: ignore[method-assign]
    with patch("manager.make_adapter", return_value=fake):
        await http_client.post("/connect", json={"roaster": "virtual"})
        response = await http_client.post("/control", json={"heater": 50})

    assert response.status == 502
    assert len(sentry_transport.events) == 1
    event = sentry_transport.events[0]
    tags = event.get("tags") or {}
    assert tags.get("event") == "control_write_failed"
    _exception_value(event)


async def test_pid_on_502_once_dedupes_across_retries(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "virtual"
    manager._protocol = "virtual"

    with patch.object(manager, "pid_start", side_effect=OSError("PLC unreachable")):
        for _ in range(3):
            response = await http_client.post("/pid/on", json={"sv": 200})
            assert response.status == 502

    assert len(sentry_transport.events) == 1
    tags = sentry_transport.events[0].get("tags") or {}
    assert tags.get("event") == "pid_on_failed"
    assert tags.get("route") == "/pid/on"
    _exception_value(sentry_transport.events[0])


async def test_pid_on_failure_then_pid_off_failure_emits_two_events(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "virtual"
    manager._protocol = "virtual"

    with patch.object(manager, "pid_start", side_effect=OSError("on fail")):
        assert (await http_client.post("/pid/on", json={"sv": 200})).status == 502

    class _Pid:
        async def off(self, reason: str = "user", *, mode: str = "hold") -> None:
            raise OSError("off fail")

        def state(self):
            return {"state": "off", "error": None}

    manager._pid = _Pid()
    assert (await http_client.post("/pid/off", json={"mode": "zero"})).status == 502

    assert len(sentry_transport.events) == 2
    events = {(e.get("tags") or {}).get("event"): (e.get("tags") or {}).get("route") for e in sentry_transport.events}
    assert events["pid_on_failed"] == "/pid/on"
    assert events["pid_request_failed"] == "/pid/off"


async def test_pid_sv_502_once_dedupes_across_retries(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "virtual"
    manager._protocol = "virtual"
    manager._pid = MagicMock()
    manager._pid.state.return_value = {"state": "on", "error": None}

    with patch.object(manager, "pid_set_sv", side_effect=OSError("sv fail")):
        for _ in range(3):
            assert (await http_client.post("/pid/sv", json={"sv": 210})).status == 502

    assert len(sentry_transport.events) == 1
    tags = sentry_transport.events[0].get("tags") or {}
    assert tags.get("event") == "pid_sv_failed"
    assert tags.get("route") == "/pid/sv"


async def test_pid_on_success_clears_once_then_failure_reports_again(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "virtual"
    manager._protocol = "virtual"
    calls = 0

    async def pid_start_side_effect(_sv: float):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("first fail")
        if calls == 2:
            manager._hw_alerts_sent.discard("pid_on_failed")
            return {"state": "on", "error": None}
        raise OSError("second fail")

    with patch.object(manager, "pid_start", side_effect=pid_start_side_effect):
        assert (await http_client.post("/pid/on", json={"sv": 200})).status == 502
        assert (await http_client.post("/pid/on", json={"sv": 200})).status == 200
        assert (await http_client.post("/pid/on", json={"sv": 200})).status == 502

    assert len(sentry_transport.events) == 2
    assert all((e.get("tags") or {}).get("event") == "pid_on_failed" for e in sentry_transport.events)


async def test_pid_sv_success_clears_once_then_failure_reports_again(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "virtual"
    manager._protocol = "virtual"
    manager._pid = MagicMock()
    calls = 0

    async def pid_set_sv_side_effect(_sv: float):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("first fail")
        if calls == 2:
            manager._hw_alerts_sent.discard("pid_sv_failed")
            return {"state": "on", "error": None}
        raise OSError("second fail")

    with patch.object(manager, "pid_set_sv", side_effect=pid_set_sv_side_effect):
        assert (await http_client.post("/pid/sv", json={"sv": 210})).status == 502
        assert (await http_client.post("/pid/sv", json={"sv": 215})).status == 200
        assert (await http_client.post("/pid/sv", json={"sv": 220})).status == 502

    assert len(sentry_transport.events) == 2
    assert all((e.get("tags") or {}).get("event") == "pid_sv_failed" for e in sentry_transport.events)


async def test_pid_off_502_once_dedupes_across_retries(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    manager._connected = True
    manager._roaster_key = "test"
    manager._protocol = "virtual"

    class _Pid:
        async def off(self, reason: str = "user", *, mode: str = "hold") -> None:
            raise OSError("PLC unreachable at 10.0.0.2:102")

        def state(self):
            return {"state": "off", "error": None}

    manager._pid = _Pid()

    for _ in range(2):
        response = await http_client.post("/pid/off", json={"mode": "zero"})
        assert response.status == 502

    assert len(sentry_transport.events) == 1
    tags = sentry_transport.events[0].get("tags") or {}
    assert tags.get("event") == "pid_request_failed"
    assert tags.get("route") == "/pid/off"
    _exception_value(sentry_transport.events[0])

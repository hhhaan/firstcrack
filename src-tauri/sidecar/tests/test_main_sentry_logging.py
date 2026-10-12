"""502 handlers must not double-report via LoggingIntegration (#773)."""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest
import sentry_sdk
from aiohttp.test_utils import TestClient, TestServer
from sentry_sdk.integrations.logging import LoggingIntegration

from main import create_app
from tests.conftest import FakeAdapter, make_reading
from tests.test_w60a_discharge import enable_discharge
from tests.test_w60a_fill import enable_fill


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


async def test_discharge_502_emits_one_tagged_sentry_event(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    enable_discharge(manager)
    manager._adapter.discharge.side_effect = ConnectionError("PLC 10.0.0.2:1112 write failed")

    response = await http_client.post(
        "/discharge",
        json={"action": "open", "machine_id": "door-test", "connection_epoch": 0},
    )
    assert response.status == 502
    assert len(sentry_transport.events) == 1
    event = sentry_transport.events[0]
    tags = event.get("tags") or {}
    assert tags.get("door") == "discharge"
    assert tags.get("event") == "discharge"
    value = _exception_value(event)
    assert "10.0.0.2" not in value
    assert ":1112" not in value


async def test_fill_502_emits_one_tagged_sentry_event(http_client, sentry_transport):
    manager = http_client.server.app["manager"]
    enable_fill(manager)
    manager._adapter.fill.side_effect = ConnectionError("PLC 10.0.0.2:1112 write failed")

    response = await http_client.post(
        "/fill",
        json={"action": "close", "machine_id": "door-test", "connection_epoch": 0},
    )
    assert response.status == 502
    assert len(sentry_transport.events) == 1
    event = sentry_transport.events[0]
    tags = event.get("tags") or {}
    assert tags.get("door") == "fill"
    assert tags.get("event") == "fill"
    _exception_value(event)


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
    assert tags.get("event") == "pid_request_failed"
    _exception_value(sentry_transport.events[0])


async def test_pid_502_once_dedupes_across_retries(http_client, sentry_transport):
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
    _exception_value(sentry_transport.events[0])

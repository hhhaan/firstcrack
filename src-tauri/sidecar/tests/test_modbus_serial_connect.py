"""Modbus RTU/ASCII connect rejects empty serial port before adapter I/O (#771-7)."""

from unittest.mock import patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from main import create_app
from manager import _validate_connect_params


def test_validate_connect_params_rejects_blank_comport():
    with pytest.raises(ValueError, match="Serial Port"):
        _validate_connect_params("modbus", {"mode": "rtu", "comport": "  "})
    _validate_connect_params("modbus", {"mode": "tcp", "comport": ""})
    _validate_connect_params("s7", {"mode": "rtu", "comport": ""})


@pytest.fixture
async def connect_client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    async with TestClient(TestServer(create_app())) as client:
        yield client


async def test_connect_empty_comport_is_400_without_sentry(connect_client):
    with patch("manager.sentry_sdk.capture_exception") as capture:
        response = await connect_client.post(
            "/connect",
            json={"roaster": "easyster", "mode": "rtu", "comport": ""},
        )
    assert response.status == 400
    body = await response.json()
    assert "Serial Port" in body["error"]
    blob = repr(body)
    assert "/dev/" not in blob and "COM" not in blob
    assert capture.call_count == 0

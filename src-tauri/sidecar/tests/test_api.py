"""HTTP endpoint tests for the aiohttp sidecar server."""
import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from adapters.base import Reading
from main import create_app
from tests.conftest import FakeAdapter, make_reading


@pytest.fixture
async def client():
    app = create_app()
    async with TestClient(TestServer(app)) as c:
        yield c
    # Cancel any reconnect task left by tests
    manager = app["manager"]
    if manager._reconnect_task is not None and not manager._reconnect_task.done():
        manager._reconnect_task.cancel()
        try:
            await manager._reconnect_task
        except (asyncio.CancelledError, Exception):
            pass


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

class TestStatusEndpoint:
    async def test_initial_status_not_connected(self, client):
        resp = await client.get("/status")
        assert resp.status == 200
        data = await resp.json()
        assert data["connected"] is False

    async def test_status_has_required_keys(self, client):
        resp = await client.get("/status")
        data = await resp.json()
        for key in ("connected", "roaster", "error", "uptime"):
            assert key in data


# ---------------------------------------------------------------------------
# POST /connect
# ---------------------------------------------------------------------------

class TestConnectEndpoint:
    async def test_missing_roaster_field_returns_400(self, client):
        resp = await client.post("/connect", json={})
        assert resp.status == 400
        data = await resp.json()
        assert "error" in data

    async def test_unknown_roaster_returns_400(self, client):
        resp = await client.post("/connect", json={"roaster": "does_not_exist_xyz"})
        assert resp.status == 400
        data = await resp.json()
        assert "error" in data

    async def test_invalid_json_returns_400(self, client):
        resp = await client.post(
            "/connect",
            data=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    async def test_successful_connect_returns_status(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            resp = await client.post("/connect", json={"roaster": "virtual"})
        assert resp.status == 200
        data = await resp.json()
        assert "connected" in data


# ---------------------------------------------------------------------------
# POST /disconnect
# ---------------------------------------------------------------------------

class TestDisconnectEndpoint:
    async def test_disconnect_when_not_connected(self, client):
        resp = await client.post("/disconnect")
        assert resp.status == 200
        data = await resp.json()
        assert data["connected"] is False

    async def test_disconnect_after_connect(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
        resp = await client.post("/disconnect")
        assert resp.status == 200
        data = await resp.json()
        assert data["connected"] is False


# ---------------------------------------------------------------------------
# GET /temperatures
# ---------------------------------------------------------------------------

class TestTemperaturesEndpoint:
    async def test_temperatures_not_connected_returns_nulls(self, client):
        resp = await client.get("/temperatures")
        assert resp.status == 200
        data = await resp.json()
        assert data["bt"] is None
        assert data["et"] is None

    async def test_temperatures_connected_returns_values(self, client):
        t = time.monotonic()
        warmup = make_reading(bt=180.0, et=220.0, ts=t)
        live = make_reading(bt=181.0, et=221.0, ts=t + 1)
        fake = FakeAdapter(readings=[warmup, live])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
        resp = await client.get("/temperatures")
        assert resp.status == 200
        data = await resp.json()
        assert data["bt"] is not None
        assert data["et"] is not None
        assert "ror" in data
        assert "heater" in data
        assert "fan" in data
        assert "drum" in data
        assert "timestamp" in data

    async def test_temperatures_required_keys_present(self, client):
        resp = await client.get("/temperatures")
        data = await resp.json()
        for key in ("bt", "et", "ror", "ror_et", "heater", "fan", "drum", "timestamp"):
            assert key in data


# ---------------------------------------------------------------------------
# POST /control
# ---------------------------------------------------------------------------

class TestControlEndpoint:
    async def test_control_invalid_json_returns_400(self, client):
        resp = await client.post(
            "/control",
            data=b"bad",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    async def test_control_when_connected_calls_adapter(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})

        with patch("manager.make_adapter", return_value=fake):
            resp = await client.post("/control", json={"heater": 80, "fan": 60})
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True

    async def test_control_empty_body_ok(self, client):
        resp = await client.post("/control", json={})
        assert resp.status == 200


# ---------------------------------------------------------------------------
# POST /start and /reset
# ---------------------------------------------------------------------------

class TestStartResetEndpoints:
    async def test_start_returns_ok(self, client):
        resp = await client.post("/start")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True

    async def test_reset_returns_ok(self, client):
        resp = await client.post("/reset")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True


# ---------------------------------------------------------------------------
# GET /roasters
# ---------------------------------------------------------------------------

class TestRoastersEndpoint:
    async def test_roasters_returns_dict(self, client):
        resp = await client.get("/roasters")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, dict)
        assert len(data) > 0

    async def test_roasters_virtual_entry_has_fields(self, client):
        resp = await client.get("/roasters")
        data = await resp.json()
        assert "virtual" in data
        entry = data["virtual"]
        for key in ("display_name", "brand", "protocol", "capabilities"):
            assert key in entry


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

class TestCors:
    async def test_options_preflight_succeeds(self, client):
        resp = await client.options("/status", headers={"Origin": "tauri://localhost"})
        assert resp.status == 200
        assert "Access-Control-Allow-Origin" in resp.headers

    async def test_allowed_tauri_mac_origin(self, client):
        resp = await client.get("/status", headers={"Origin": "tauri://localhost"})
        assert resp.headers.get("Access-Control-Allow-Origin") == "tauri://localhost"

    async def test_allowed_tauri_win_origin(self, client):
        resp = await client.get("/status", headers={"Origin": "http://tauri.localhost"})
        assert resp.headers.get("Access-Control-Allow-Origin") == "http://tauri.localhost"

    async def test_allowed_dev_origin(self, client):
        resp = await client.get("/status", headers={"Origin": "http://localhost:1420"})
        assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:1420"

    async def test_unknown_origin_not_reflected(self, client):
        resp = await client.get("/status", headers={"Origin": "http://evil.com"})
        assert resp.headers.get("Access-Control-Allow-Origin") != "http://evil.com"

    async def test_private_network_header_on_allowed_origin(self, client):
        resp = await client.get("/status", headers={"Origin": "tauri://localhost"})
        assert resp.headers.get("Access-Control-Allow-Private-Network") == "true"

    async def test_no_private_network_header_on_unknown_origin(self, client):
        resp = await client.get("/status", headers={"Origin": "http://evil.com"})
        assert "Access-Control-Allow-Private-Network" not in resp.headers


# ---------------------------------------------------------------------------
# 토큰 인증 (H3)
# ---------------------------------------------------------------------------

class TestTokenAuth:
    @pytest.fixture
    async def token_client(self, monkeypatch):
        monkeypatch.setenv("SIDECAR_TOKEN", "secret-token")
        app = create_app()
        async with TestClient(TestServer(app)) as c:
            yield c

    async def test_request_without_token_is_rejected(self, token_client):
        resp = await token_client.get("/status")
        assert resp.status == 401

    async def test_request_with_wrong_token_is_rejected(self, token_client):
        resp = await token_client.post("/shutdown", headers={"X-Sidecar-Token": "nope"})
        assert resp.status == 401

    async def test_request_with_token_passes(self, token_client):
        resp = await token_client.get("/status", headers={"X-Sidecar-Token": "secret-token"})
        assert resp.status == 200

    async def test_preflight_passes_without_token(self, token_client):
        """브라우저 preflight에는 커스텀 헤더가 실리지 않는다."""
        resp = await token_client.options("/status", headers={"Origin": "tauri://localhost"})
        assert resp.status == 200

    async def test_rejected_response_still_has_cors_headers(self, token_client):
        resp = await token_client.get("/status", headers={"Origin": "tauri://localhost"})
        assert resp.status == 401
        assert resp.headers.get("Access-Control-Allow-Origin") == "tauri://localhost"

    async def test_no_token_env_means_no_auth(self, client):
        """env 부재 시 인증을 건너뛴다 (dev 호환)."""
        resp = await client.get("/status")
        assert resp.status == 200

    async def test_token_header_is_allowed_by_cors(self, client):
        resp = await client.options("/status", headers={"Origin": "tauri://localhost"})
        assert "X-Sidecar-Token" in resp.headers.get("Access-Control-Allow-Headers", "")


# ---------------------------------------------------------------------------
# GET/POST /debug/trace, GET /debug/probe
# ---------------------------------------------------------------------------

class TestDebugEndpoints:
    async def test_trace_toggle(self, client):
        # 기본 OFF
        resp = await client.get("/debug/trace")
        body = await resp.json()
        assert body["enabled"] is False

        # 켜기
        resp = await client.post("/debug/trace", json={"enabled": True})
        assert (await resp.json())["enabled"] is True

        # 끄기 + 클리어
        resp = await client.post("/debug/trace", json={"enabled": False, "clear": True})
        body = await resp.json()
        assert body["enabled"] is False

        resp = await client.get("/debug/trace")
        body = await resp.json()
        assert body["count"] == 0

    async def test_probe_without_adapter(self, client):
        resp = await client.get("/debug/probe")
        body = await resp.json()
        assert body["ok"] is False
        assert "error" in body

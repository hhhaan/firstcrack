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
async def client(monkeypatch):
    # 개발 셸에 SIDECAR_TOKEN이 export돼 있어도 기본 fixture는 인증 없이 동작해야 한다
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    app = create_app()
    async with TestClient(TestServer(app)) as c:
        yield c
    # Cancel any background task left by tests
    manager = app["manager"]
    for task in (manager._reconnect_task, manager._heat.task, manager._connect_task):
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
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
        for key in ("bt", "bt_raw", "et", "et_raw", "ror", "ror_et", "heater", "heater_set", "fan", "drum", "timestamp"):
            assert key in data

    async def test_temperatures_heater_set_follows_control_writes(self, client):
        """heater_set = 이 연결에서 마지막으로 쓴 세트포인트. 쓰기 전·해제 후는 None."""
        fake = FakeAdapter(readings=[make_reading(bt=150.0)] * 6)
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
        assert (await (await client.get("/temperatures")).json())["heater_set"] is None

        resp = await client.post("/control", json={"heater": 72.4})
        assert (await resp.json())["applied"] == {"heater": 72.4}
        assert (await (await client.get("/temperatures")).json())["heater_set"] == 72.4

        await client.post("/disconnect")
        assert (await (await client.get("/temperatures")).json())["heater_set"] is None


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
        assert data["applied"] == {"heater": 80.0, "fan": 60.0}
        assert fake.control_calls == [{"heater": 80.0, "fan": 60.0, "drum": None}]

    async def test_control_clamps_to_write_map_range(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
            resp = await client.post("/control", json={"heater": 150, "fan": -20})
        assert resp.status == 200
        assert (await resp.json())["applied"] == {"heater": 100.0, "fan": 0.0}

    async def test_control_empty_body_ok(self, client):
        """빈 요청은 미연결이어도 200 no-op — 검증할 값이 없다."""
        resp = await client.post("/control", json={})
        assert resp.status == 200
        assert (await resp.json())["applied"] == {}

    async def test_control_while_disconnected_returns_409(self, client):
        resp = await client.post("/control", json={"heater": 50})
        assert resp.status == 409
        assert "error" in await resp.json()

    async def test_control_non_object_body_returns_400(self, client):
        """JSON 배열/문자열은 클라이언트 잘못이므로 502가 아니라 400이다."""
        resp = await client.post("/control", data=b"[1,2]", headers={"Content-Type": "application/json"})
        assert resp.status == 400

    async def test_control_non_numeric_returns_400(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
            resp = await client.post("/control", json={"heater": "hot"})
        assert resp.status == 400
        assert fake.control_calls == []

    async def test_control_unsupported_role_returns_409(self, client):
        """기본 custom_probat_ws는 write_map이 없다 — 쓰기 미지원."""
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "custom_probat_ws"})
            resp = await client.post("/control", json={"heater": 50})
        assert resp.status == 409
        assert fake.control_calls == []

    async def test_status_reports_control_capability(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})
            resp = await client.get("/status")
        control = (await resp.json())["control"]
        assert control["writable"] is True
        assert control["limits"]["heater"]["max"] == 100
        assert control["limits"]["heater"]["unit"] == "%"

    async def test_status_reports_coarse_heater_scale(self, client):
        """giesen_wxa_coarse write_map(0~10 step)이 /status.control.limits로 나간다 (#428)."""
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "giesen_wxa_coarse"})
            resp = await client.get("/status")
        heater = (await resp.json())["control"]["limits"]["heater"]
        assert heater["max"] == 10
        assert heater["unit"] == "step"

    async def test_w45a_w60a_status_and_drum_only_control(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            resp = await client.post("/connect", json={"roaster": "giesen_w45a_w60a"})
        assert resp.status == 200
        control = (await (await client.get("/status")).json())["control"]
        assert control["writable"] is True
        assert set(control["limits"]) == {"heater", "drum"}
        drum = control["limits"]["drum"]
        assert (drum["min"], drum["max"], drum["unit"]) == (40, 55, "Hz")

        resp = await client.post("/control", json={"drum": 60})
        assert resp.status == 200
        assert (await resp.json())["applied"] == {"drum": 55}
        assert fake.control_calls == [{"heater": None, "fan": None, "drum": 55}]
        resp = await client.post("/control", json={"fan": 50})
        assert resp.status == 400
        assert len(fake.control_calls) == 1

    async def test_status_reports_not_writable_before_connect(self, client):
        control = (await (await client.get("/status")).json())["control"]
        assert control["writable"] is False
        assert control["limits"] == {}
        assert control["pid"]["supported"] is False


# ---------------------------------------------------------------------------
# POST /pid/*
# ---------------------------------------------------------------------------

class TestPidEndpoints:
    async def _connect_virtual(self, client, fake):
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "virtual"})

    async def test_pid_on_while_disconnected_returns_409(self, client):
        resp = await client.post("/pid/on", json={"sv": 200})
        assert resp.status == 409

    async def test_pid_on_starts_and_reports_state(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        resp = await client.post("/pid/on", json={"sv": 200})
        assert resp.status == 200
        pid = (await resp.json())["pid"]
        assert pid["state"] == "running"
        assert pid["sv"] == 200.0

    async def test_pid_on_rejects_sv_out_of_range(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        resp = await client.post("/pid/on", json={"sv": 900})
        assert resp.status == 400

    async def test_pid_on_non_object_body_returns_400(self, client):
        resp = await client.post("/pid/on", data=b'"hot"', headers={"Content-Type": "application/json"})
        assert resp.status == 400

    async def test_pid_on_rejects_non_numeric_sv(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        assert (await client.post("/pid/on", json={"sv": "hot"})).status == 400

    async def test_pid_on_unsupported_machine_returns_409(self, client):
        """probat_ws는 수동 쓰기를 지원해도 PID 게인은 없다."""
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        with patch("manager.make_adapter", return_value=fake):
            await client.post("/connect", json={"roaster": "probat_ws"})
        assert (await client.post("/pid/on", json={"sv": 200})).status == 409

    async def test_pid_off_is_idempotent(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        assert (await client.post("/pid/off", json={})).status == 200
        await client.post("/pid/on", json={"sv": 200})
        assert (await client.post("/pid/off", json={"mode": "zero"})).status == 200
        assert (await client.post("/pid/off", json={"mode": "zero"})).status == 200

    async def test_pid_off_rejects_unknown_mode(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        assert (await client.post("/pid/off", json={"mode": "explode"})).status == 400

    async def test_pid_sv_before_start_returns_409(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        assert (await client.post("/pid/sv", json={"sv": 210})).status == 409

    async def test_pid_sv_updates_target(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        await client.post("/pid/on", json={"sv": 200})
        resp = await client.post("/pid/sv", json={"sv": 215})
        assert resp.status == 200
        assert (await resp.json())["pid"]["sv"] == 215.0

    async def test_temperatures_includes_pid_block_once_started(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(10)])
        await self._connect_virtual(client, fake)
        assert "pid" not in await (await client.get("/temperatures")).json()
        await client.post("/pid/on", json={"sv": 200})
        data = await (await client.get("/temperatures")).json()
        assert data["pid"]["state"] == "running"

    async def test_status_reports_pid_capability_for_virtual(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(5)])
        await self._connect_virtual(client, fake)
        pid = (await (await client.get("/status")).json())["control"]["pid"]
        assert pid["supported"] is True
        assert pid["sv_min"] < pid["sv_max"]

    async def test_disconnect_cancels_pid_task(self, client):
        fake = FakeAdapter(readings=[make_reading(bt=180.0) for _ in range(10)])
        await self._connect_virtual(client, fake)
        await client.post("/pid/on", json={"sv": 200})
        manager = client.app["manager"]
        assert manager._heat.task is not None
        await client.post("/disconnect")
        assert manager._heat.task is None
        assert manager.pid_state() is None


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


# ---------------------------------------------------------------------------
# GET /scan-network
# ---------------------------------------------------------------------------

class TestScanNetworkEndpoint:
    async def test_missing_protocol_returns_400(self, client):
        resp = await client.get("/scan-network")
        assert resp.status == 400
        data = await resp.json()
        assert "error" in data

    async def test_unknown_protocol_returns_400(self, client):
        resp = await client.get("/scan-network?protocol=nope")
        assert resp.status == 400
        data = await resp.json()
        assert data["error"] == "unknown protocol"

    async def test_scan_returns_mocked_hosts(self, client):
        with patch("scanner.scan_protocol", new_callable=AsyncMock) as mock_scan:
            mock_scan.return_value = [{"host": "192.168.1.10"}]
            resp = await client.get("/scan-network?protocol=s7")
        assert resp.status == 200
        data = await resp.json()
        assert data == [{"host": "192.168.1.10"}]
        mock_scan.assert_awaited_once_with("s7")


# ---------------------------------------------------------------------------
# POST /disconnect during an in-flight /connect (#208)
# ---------------------------------------------------------------------------

class TestDisconnectDuringConnect:
    async def test_disconnect_completes_while_connect_pending(self, client):
        """HTTP 경로 전체에서도 성립해야 한다 — 핸들러가 얇아야 cancel-first가 산다."""
        fake = FakeAdapter(connect_gate=asyncio.Event())

        with patch("manager.make_adapter", return_value=fake):
            connect_req = asyncio.create_task(
                client.post("/connect", json={"roaster": "virtual"})
            )
            await asyncio.wait_for(fake.connect_started.wait(), timeout=2.0)

            resp = await asyncio.wait_for(client.post("/disconnect"), timeout=1.0)
            assert resp.status == 200
            assert (await resp.json())["connected"] is False

            connect_resp = await asyncio.wait_for(connect_req, timeout=2.0)

        assert connect_resp.status == 200
        data = await connect_resp.json()
        assert data["connected"] is False
        assert data["error"] is None, "취소는 실패가 아니다"
        assert fake.connect_cancelled is True


@pytest.mark.parametrize("origin", ["safety", "pid", "curve", None, 1])
async def test_external_control_cannot_request_internal_authority(client, origin):
    response = await client.post("/control", json={"heater": 0, "origin": origin})
    assert response.status == 400


@pytest.mark.parametrize("endpoint", ["/connect", "/disconnect", "/reset"])
async def test_connection_terminal_timeout_returns_uncertainty_without_detaching(client, endpoint):
    await client.post("/connect", json={"roaster": "virtual", "machine_id": "old"})
    manager = client.server.app["manager"]
    adapter = manager._adapter
    original_control = adapter.control
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked(**values):
        entered.set()
        await release.wait()
        await original_control(**values)

    adapter.control = blocked
    writer = asyncio.create_task(manager.control(fan=30))
    await asyncio.wait_for(entered.wait(), 1)
    manager._heat.barrier_timeout = 0.01
    try:
        response = await client.post(endpoint, json={"roaster": "virtual", "machine_id": "new"})
        assert response.status == 504
        body = await response.json()
        assert body["uncertain"] is True
        assert body["error"]
        assert "ok" not in body
        assert manager._adapter is adapter
        assert manager._machine_id == "old"
        assert manager._heat.state()["pending_writes"] == 1
        assert manager._heat.state()["uncertain"]
    finally:
        release.set()
        await asyncio.gather(writer, return_exceptions=True)
        await manager.disconnect()

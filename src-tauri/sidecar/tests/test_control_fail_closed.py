"""#270: control()은 실제 쓰기가 있을 때만 성공으로 보고한다."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from adapters import WRITABLE_PROTOCOLS, _PROTOCOL_ADAPTER
from adapters.kaleido import KaleidoAdapter
from adapters.modbus import ModbusAdapter
from adapters.phidget import PhidgetAdapter
from adapters.probat_ws import ProbatWSAdapter
from adapters.s7 import S7Adapter
from adapters.virtual import VirtualMachineAdapter
from control_guard import ControlUnavailable
from main import create_app
from manager import RoasterManager
from roaster_registry import ROASTER_REGISTRY
from tests.conftest import FakeAdapter, make_reading

from tests.test_s7_adapter import GIESEN_CHANNELS, GIESEN_WRITE_MAP

_CLIENT_WRITE_MAP = {"heater": {"min": 0, "max": 100, "unit": "%"}}

NOOP_ROASTERS = (
    ("kaleido", "kaleido"),
    ("custom_modbus", "modbus"),
    ("custom_phidget", "phidget"),
    ("custom_probat_ws", "probat_ws"),
)

NOOP_ADAPTERS = (
    KaleidoAdapter,
    ModbusAdapter,
    PhidgetAdapter,
    ProbatWSAdapter,
)


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    app = create_app()
    async with TestClient(TestServer(app)) as c:
        yield c
    manager = app["manager"]
    for task in (manager._reconnect_task, manager._pid_task, manager._connect_task):
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def _bind_virtual(manager: RoasterManager, adapter: VirtualMachineAdapter) -> None:
    defaults = ROASTER_REGISTRY["virtual"]["default_params"]
    manager._adapter = adapter
    manager._connected = True
    manager._protocol = "virtual"
    manager._roaster_key = "virtual"
    manager._merged_params = dict(defaults)


class TestNoopProtocolControl:
    @pytest.mark.parametrize("roaster,protocol", NOOP_ROASTERS)
    async def test_noop_protocol_with_write_map_not_200(self, client, roaster, protocol):
        cls = _PROTOCOL_ADAPTER[protocol]
        assert protocol not in WRITABLE_PROTOCOLS
        with (
            patch.object(cls, "connect", new_callable=AsyncMock),
            patch.object(cls, "disconnect", new_callable=AsyncMock),
        ):
            connected = await client.post(
                "/connect",
                json={"roaster": roaster, "write_map": _CLIENT_WRITE_MAP},
            )
            assert connected.status == 200
            assert (await connected.json())["connected"] is True

            resp = await client.post("/control", json={"heater": 50})
            assert resp.status != 200
            assert resp.status == 409

    @pytest.mark.parametrize("adapter_cls", NOOP_ADAPTERS)
    async def test_noop_adapter_control_unavailable(self, manager, adapter_cls):
        adapter = adapter_cls()
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = {
            KaleidoAdapter: "kaleido",
            ModbusAdapter: "modbus",
            PhidgetAdapter: "phidget",
            ProbatWSAdapter: "probat_ws",
        }[adapter_cls]
        manager._merged_params = {"write_map": _CLIENT_WRITE_MAP}

        with pytest.raises(ControlUnavailable):
            await manager.control(heater=50)


class TestWritableHonorsProtocol:
    """write_map만 있으면 kaleido PID/제어 UI가 열리는 구멍 (#270 B1)."""

    def test_registry_write_maps_only_on_writable_protocols(self):
        protocols = {
            v["protocol"]
            for v in ROASTER_REGISTRY.values()
            if v["default_params"].get("write_map")
        }
        assert protocols <= WRITABLE_PROTOCOLS

    @pytest.mark.parametrize("roaster", ("kaleido", "custom_kaleido"))
    def test_kaleido_client_write_map_not_writable(self, manager, roaster):
        assert ROASTER_REGISTRY[roaster]["pid"]
        manager._connected = True
        manager._protocol = "kaleido"
        manager._roaster_key = roaster
        manager._merged_params = {"write_map": _CLIENT_WRITE_MAP}

        control = manager.status()["control"]
        assert "heater" in manager.write_limits()
        assert control["writable"] is False
        assert control["pid"]["supported"] is False
        assert manager.pid_capability()["supported"] is False

    @pytest.mark.parametrize("roaster", ("kaleido", "custom_kaleido"))
    async def test_kaleido_client_write_map_http_not_writable(self, client, roaster):
        with (
            patch.object(KaleidoAdapter, "connect", new_callable=AsyncMock),
            patch.object(KaleidoAdapter, "disconnect", new_callable=AsyncMock),
        ):
            connected = await client.post(
                "/connect",
                json={"roaster": roaster, "write_map": _CLIENT_WRITE_MAP},
            )
            assert connected.status == 200

            control = (await (await client.get("/status")).json())["control"]
            assert control["writable"] is False
            assert control["pid"]["supported"] is False

            pid = await client.post("/pid/on", json={"sv": 200})
            assert pid.status == 409


class TestS7PlcNone:
    async def test_s7_plc_none_is_not_success(self, manager):
        adapter = S7Adapter(
            host="127.0.0.1",
            channels=GIESEN_CHANNELS,
            write_map=GIESEN_WRITE_MAP,
        )
        assert adapter._plc is None
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "s7"
        manager._roaster_key = "giesen_standard"
        manager._merged_params = {"write_map": GIESEN_WRITE_MAP}

        with pytest.raises((ControlUnavailable, ConnectionError)):
            await manager.control(heater=50)


class TestConnectMapMerge:
    async def test_empty_client_write_map_keeps_registry(self, manager):
        await manager.connect("virtual", {"write_map": {}})
        expected = ROASTER_REGISTRY["virtual"]["default_params"]["write_map"]
        assert manager._merged_params["write_map"] == expected
        assert manager._adapter.write_map == expected

    async def test_empty_client_maps_keep_giesen_registry(self, manager):
        with (
            patch.object(S7Adapter, "connect", new_callable=AsyncMock),
            patch.object(S7Adapter, "disconnect", new_callable=AsyncMock),
        ):
            await manager.connect(
                "giesen_standard", {"write_map": {}, "channels": {}}
            )
        defaults = ROASTER_REGISTRY["giesen_standard"]["default_params"]
        assert manager._merged_params["write_map"] == defaults["write_map"]
        assert manager._merged_params["channels"] == defaults["channels"]
        assert manager._adapter._write_map == defaults["write_map"]
        assert manager._adapter._channels == defaults["channels"]


class TestResetRoast:
    @pytest.mark.parametrize(
        "roaster", ["custom_modbus", "custom_phidget", "custom_probat_ws", "kaleido", "giesen_standard"]
    )
    async def test_real_machine_stays_connected_between_roasts(self, manager, roaster):
        adapter = FakeAdapter(readings=[make_reading(bt=150 + i) for i in range(3)])
        with patch("manager.make_adapter", return_value=adapter):
            await manager.connect(roaster, {})
        epoch = manager._connection_epoch
        manager._last_applied = {"heater": 70}

        for i in range(3):
            await manager.enter_standby()
            await manager.start_roast()
            assert (await manager.read_temperatures())["bt_raw"] == 150 + i
            await manager.reset_roast()
            assert manager.status()["connected"] is True
            assert manager.status()["reconnecting"] is False
            assert manager._connection_epoch == epoch
            assert manager.last_applied() == {"heater": 70}
            assert adapter.connect_call_count == 1
            assert adapter.disconnected is False
            assert adapter.control_calls == []

        await manager.disconnect()
        assert adapter.disconnected is True
        assert manager.status()["connected"] is False

    async def test_reset_reconnect_fail_sets_connected_false(self, manager):
        defaults = ROASTER_REGISTRY["virtual"]["default_params"]
        adapter = VirtualMachineAdapter(write_map=defaults["write_map"])
        await adapter.connect()
        _bind_virtual(manager, adapter)

        stopped: list[tuple[str, str, bool]] = []

        class _Pid:
            async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
                stopped.append((reason, mode, manager._connected))

        manager._pid = _Pid()

        async def boom() -> None:
            raise ConnectionError("Connection refused")

        adapter.connect = boom  # type: ignore[method-assign]

        with pytest.raises(ConnectionError):
            await manager.reset_roast()

        assert manager._connected is False
        assert manager.status()["connected"] is False
        assert manager._reconnecting()
        assert manager.status()["reconnecting"] is True
        assert manager._pid is None
        assert stopped == [("reset", "zero", True)]

    async def test_reset_reconnect_fail_loop_retries_connect(self, manager, monkeypatch):
        import config

        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01])
        defaults = ROASTER_REGISTRY["virtual"]["default_params"]
        adapter = VirtualMachineAdapter(write_map=defaults["write_map"])
        await adapter.connect()
        _bind_virtual(manager, adapter)

        calls = {"n": 0}

        async def boom() -> None:
            calls["n"] += 1
            raise ConnectionError("Connection refused")

        adapter.connect = boom  # type: ignore[method-assign]

        with pytest.raises(ConnectionError):
            await manager.reset_roast()
        assert calls["n"] == 1
        assert manager._connected is False
        assert manager._reconnecting()
        for _ in range(50):
            if calls["n"] >= 2:
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("reconnect loop did not retry connect")

    async def test_reset_reconnect_fail_http_matches_state(self, client):
        defaults = ROASTER_REGISTRY["virtual"]["default_params"]
        adapter = VirtualMachineAdapter(write_map=defaults["write_map"])
        with patch("manager.make_adapter", return_value=adapter):
            resp = await client.post("/connect", json={"roaster": "virtual"})
        assert resp.status == 200

        async def boom() -> None:
            raise ConnectionError("Connection refused")

        adapter.connect = boom  # type: ignore[method-assign]

        resp = await client.post("/reset")
        assert resp.status != 200
        body = await resp.json()
        assert body["connected"] is False
        status = await (await client.get("/status")).json()
        assert status["connected"] is False
        assert status["reconnecting"] is True

    async def test_control_rejected_during_reset(self, manager):
        defaults = ROASTER_REGISTRY["virtual"]["default_params"]
        adapter = VirtualMachineAdapter(write_map=defaults["write_map"])
        await adapter.connect()
        _bind_virtual(manager, adapter)

        gate = asyncio.Event()
        orig_connect = VirtualMachineAdapter.connect

        async def gated() -> None:
            await gate.wait()
            await orig_connect(adapter)

        adapter.connect = gated  # type: ignore[method-assign]
        reset_task = asyncio.create_task(manager.reset_roast())
        try:
            for _ in range(200):
                if manager._resetting:
                    break
                await asyncio.sleep(0.01)
            else:
                pytest.fail("reset did not raise the write gate")

            with pytest.raises(ControlUnavailable, match="초기화"):
                await manager.control(heater=50)
            with pytest.raises(ControlUnavailable, match="초기화"):
                await manager._pid_write_duty(40.0)
        finally:
            gate.set()
            await reset_task
        assert manager._resetting is False

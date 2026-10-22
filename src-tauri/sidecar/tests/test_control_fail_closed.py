"""#270: control()은 실제 쓰기가 있을 때만 성공으로 보고한다."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

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
from heater_control_session import PidOperation
from manager import RoasterManager
from roaster_registry import ROASTER_REGISTRY
from tests.conftest import FakeAdapter, make_reading

from tests.test_s7_adapter import GIESEN_CHANNELS, GIESEN_WRITE_MAP, _int_bytes

_CLIENT_WRITE_MAP = {"heater": {"min": 0, "max": 100, "unit": "%"}}

NOOP_ROASTERS = (
    ("kaleido", "kaleido"),
    ("custom_modbus", "modbus"),
    ("custom_phidget", "phidget"),
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
    for task in (manager._reconnect_task, manager._heat.task, manager._connect_task):
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


class TestProbatWsWriteMap:
    async def test_min_max_only_map_is_not_writable(self, client):
        with (
            patch.object(ProbatWSAdapter, "connect", new_callable=AsyncMock),
            patch.object(ProbatWSAdapter, "disconnect", new_callable=AsyncMock),
        ):
            connected = await client.post(
                "/connect",
                json={"roaster": "custom_probat_ws", "write_map": _CLIENT_WRITE_MAP},
            )
            assert connected.status == 200
            resp = await client.post("/control", json={"heater": 50})
            assert resp.status == 409

    def test_registry_presets_are_writable(self, manager):
        for key in ("probat_ws", "probat_sample_ws", "probat_gug_control_s7"):
            reg = ROASTER_REGISTRY[key]
            manager._connected = True
            manager._protocol = reg["protocol"]
            manager._roaster_key = key
            manager._merged_params = dict(reg["default_params"])
            assert "heater" in manager.write_limits()
            assert manager.status()["control"]["writable"] is True

    async def test_set_control_params_uses_artisan_nodes(self):
        adapter = ProbatWSAdapter(write_map=ROASTER_REGISTRY["probat_ws"]["default_params"]["write_map"])
        sent: list[str] = []

        class FakeWs:
            async def send(self, raw: str) -> None:
                sent.append(raw)

        adapter._ws = FakeWs()
        adapter._connected = True
        await adapter.control(heater=40, fan=10)
        payloads = [__import__("json").loads(raw) for raw in sent]
        assert [item["params"] for item in payloads] == [{"burner": 40}, {"exhaustFan": 10}]
        assert all(item["command"] == "setControlParams" for item in payloads)

    async def test_control_without_socket_does_not_succeed(self):
        adapter = ProbatWSAdapter(write_map=ROASTER_REGISTRY["probat_ws"]["default_params"]["write_map"])
        with pytest.raises(ConnectionError):
            await adapter.control(heater=40)

    async def test_control_send_failure_closes_connection(self):
        adapter = ProbatWSAdapter(write_map=ROASTER_REGISTRY["probat_ws"]["default_params"]["write_map"])
        socket = AsyncMock()
        socket.send.side_effect = OSError("write failed")
        adapter._ws = socket
        adapter._connected = True

        with pytest.raises(ConnectionError):
            await adapter.control(heater=40)

        socket.close.assert_awaited_once()
        assert adapter._ws is None
        assert adapter.connected is False


@pytest.mark.parametrize(
    "role,offset,minimum,maximum,unit",
    [("heater", 80, 0, 100, "%"), ("fan", 64, 25, 100, "%"), ("drum", 72, 25, 60, "RPM")],
)
def test_probat_gug_control_s7_write_map(role, offset, minimum, maximum, unit):
    params = ROASTER_REGISTRY["probat_gug_control_s7"]["default_params"]
    spec = params["write_map"][role]
    assert (spec["db"], spec["offset"], spec["type"], spec["div"]) == (200, offset, 0, 0)
    assert (spec["min"], spec["max"], spec["unit"]) == (minimum, maximum, unit)
    read = next(channel for channel in params["channels"] if channel["role"] == role)
    assert (read["db"], read["offset"]) == (spec["db"], spec["offset"])


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


class TestS7ControlAcknowledgement:
    @pytest.mark.parametrize("retry_epoch", [None, True, -1, "0"])
    async def test_retry_epoch_requires_a_nonnegative_integer(self, client, retry_epoch):
        response = await client.post("/control", json={"heater": 0, "retry_epoch": retry_epoch})
        assert response.status == 400

    async def test_http_retry_confirms_a_previously_written_value_without_resending(self, client):
        manager = client.app["manager"]
        defaults = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
        adapter = S7Adapter(channels=defaults["channels"], write_map=defaults["write_map"])
        adapter._min_interval = 0
        plc = MagicMock()
        plc.db_read.side_effect = TimeoutError("acknowledgement lost")
        adapter._plc = plc
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "s7"
        manager._merged_params = defaults
        first = await client.post("/control", json={"heater": 0})
        assert first.status == 502
        plc.db_read.side_effect = None
        plc.db_read.return_value = _int_bytes(1)
        retried = await client.post("/control", json={"heater": 0, "retry_epoch": 0})
        assert retried.status == 200
        assert (await retried.json())["applied"] == {"heater": 0}
        plc.db_write.assert_called_once()

    @pytest.mark.parametrize("raw, status", [(0, 502), (21, 502), (1, 200)])
    async def test_giesen_zero_http_ack_requires_command_readback(self, client, raw, status):
        manager = client.app["manager"]
        defaults = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
        adapter = S7Adapter(channels=defaults["channels"], write_map=defaults["write_map"])
        adapter._min_interval = 0
        plc = MagicMock()
        plc.db_read.return_value = _int_bytes(raw)
        adapter._plc = plc
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "s7"
        manager._merged_params = defaults
        response = await client.post("/control", json={"heater": 0})
        assert response.status == status
        body = await response.json()
        if status == 200:
            assert body == {"ok": True, "applied": {"heater": 0}}
            assert manager.last_applied() == {"heater": 0}
        else:
            assert "applied" not in body
            assert manager.last_applied() == {}
        plc.db_write.assert_called_once()
        plc.db_read.assert_called_once_with(2, 14, 2)

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
            state_name = "running"

            def state(self):
                return {"state": self.state_name, "error": None}
            async def stop(self, reason: str = "user", *, mode: str = "hold", write_final=None, force=False) -> None:
                stopped.append((reason, mode, manager._connected))

        manager._heat.runner = _Pid()
        manager._heat._operation = PidOperation(manager._heat.ticket, manager._heat.runner, "active")

        async def boom() -> None:
            raise ConnectionError("Connection refused")

        adapter.connect = boom  # type: ignore[method-assign]

        with pytest.raises(ConnectionError):
            await manager.reset_roast()

        assert manager._connected is False
        assert manager.status()["connected"] is False
        assert manager._reconnecting()
        assert manager.status()["reconnecting"] is True
        assert manager._heat.runner is None
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
            with pytest.raises(ControlUnavailable):
                await manager.pid_start(180.0)
        finally:
            gate.set()
            await reset_task
        assert manager._resetting is False


async def test_probat_heater_transport_observation_survives_later_fan_failure():
    adapter = ProbatWSAdapter(write_map={"heater": {"node": "burner"}, "fan": {"node": "fan"}})
    adapter._ws = object()
    facts = []
    async def send(payload):
        if "fan" in payload["params"]:
            raise OSError("fan send failed")
    adapter._send = send
    with pytest.raises(OSError):
        await adapter.control(heater=35, fan=20, _heater_observer=lambda *fact: facts.append(fact))
    assert facts == [("transport_sent", 35)]

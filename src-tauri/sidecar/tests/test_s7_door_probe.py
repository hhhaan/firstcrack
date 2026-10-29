"""W60A actuator traffic matches the pinned Artisan preset without extra reads."""

import logging
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer
from snap7.type import Area
from snap7.util.getters import get_int
from snap7.util.setters import set_int

from adapters.s7 import S7Adapter
from control_guard import ControlRangeError, ControlUnavailable
from main import create_app


def _int_bytes(value: int) -> bytearray:
    payload = bytearray(2)
    set_int(payload, 0, value)
    return payload


def _adapter(registers: dict[tuple[int, int], bytearray]) -> S7Adapter:
    adapter = S7Adapter(host="127.0.0.1", channels=[{"role": "BT", "db": 3, "offset": 116, "type": 1}])
    plc = MagicMock()
    plc.db_write.side_effect = lambda db, offset, payload: registers.update({(db, offset): bytearray(payload)})
    plc.db_read.side_effect = lambda db, offset, size: registers.get((db, offset), bytearray(size))[:size]
    plc.read_area.side_effect = lambda area, db, offset, size: registers.get((db, offset), bytearray(size))[:size]
    plc.write_area.side_effect = lambda area, db, offset, payload: registers.update({(db, offset): bytearray(payload)})
    adapter._plc = plc
    adapter._min_interval = 0.0
    return adapter


class TestDoorProbe:
    async def test_read_does_not_write(self):
        registers = {(2, 30): _int_bytes(6), (2, 82): bytearray([1 << 6])}
        adapter = _adapter(registers)
        result = await adapter.door_probe(None)
        adapter._plc.db_write.assert_not_called()
        assert result["wrote"] is None
        assert result["command_before"] == 6
        assert result["command_after"] == 6
        assert result["command_held"] is None
        assert result["discharge_open_before"] is True
        assert result["discharge_open_after"] is True

    # Artisan 5be39f640bced5e1e555d645f864daeae66ac11f, W60A.aset:113.
    @pytest.mark.parametrize("method,value,expected", [
        ("door_probe", 1, [(2, 30, b"\x00\x01")]),
        ("door_probe", 2, [(2, 30, b"\x00\x02")]),
        ("door_probe", 5, [(2, 30, b"\x00\x05")]),
        ("door_probe", 6, [(2, 30, b"\x00\x06")]),
        ("cooling_fan_probe", True, [(2, 30, b"\x00\x08"), (3, 0, b"\xa5"), (2, 30, b"\x00\x00")]),
        ("cooling_fan_probe", False, [(2, 30, b"\x00\x0a"), (3, 0, b"\xa4"), (2, 30, b"\x00\x00")]),
        ("stirrer_probe", True, [(2, 30, b"\x00\x07"), (2, 83, b"\xa6"), (2, 30, b"\x00\x00")]),
        ("stirrer_probe", False, [(2, 30, b"\x00\x09"), (2, 83, b"\xa4"), (2, 30, b"\x00\x00")]),
    ])
    async def test_exact_artisan_io_and_unobserved_feedback(self, method, value, expected):
        adapter = _adapter({(3, 0): bytearray(b"\xa5"), (2, 83): bytearray(b"\xa6")})
        result = await getattr(adapter, method)(value)
        calls = [(c[0], c.args) for c in adapter._plc.mock_calls]
        traffic = []
        for db, offset, payload in expected:
            traffic.extend([
                ("read_area", (Area.DB, db, offset, len(payload))),
                ("write_area", (Area.DB, db, offset, bytearray(payload))),
            ])
        assert calls == traffic
        assert result["wrote"] == int.from_bytes(expected[0][2], "big")
        assert result["command_before"] == 0
        for key in ("command_after", "command_held", "discharge_open_before", "discharge_open_after"):
            assert result[key] is None
        for key in ("cool_fan_after", "cool_fan_held", "stirrer_after", "stirrer_held"):
            assert result.get(key) is None

    async def test_write_uses_the_same_buffer_read_by_artisan(self):
        command = _int_bytes(7)
        adapter = _adapter({})
        adapter._plc.read_area.return_value = command
        adapter._plc.read_area.side_effect = None
        await adapter.door_probe(5)
        assert adapter._plc.write_area.call_args.args[3] is command
        assert get_int(command, 0) == 5

    async def test_locks_each_rmw_and_allows_polling_between_commands(self):
        adapter = _adapter({})
        lock = threading.Lock()
        acquisitions = []
        releases = []

        class ObservedLock:
            def acquire(self, timeout):
                acquisitions.append(len(adapter._plc.mock_calls))
                return lock.acquire(timeout=timeout)

            def release(self):
                releases.append(len(adapter._plc.mock_calls))
                lock.release()

        adapter._io_lock = ObservedLock()
        read = adapter._plc.read_area.side_effect
        write = adapter._plc.write_area.side_effect

        def checked_read(*args):
            assert lock.locked()
            return read(*args)

        def checked_write(*args):
            assert lock.locked()
            write(*args)

        adapter._plc.read_area.side_effect = checked_read
        adapter._plc.write_area.side_effect = checked_write
        await adapter.stirrer_probe(True)
        assert acquisitions == [0, 2, 4]
        assert releases == [2, 4, 6]
        assert not lock.locked()

    @pytest.mark.parametrize("latency,spacing", [(0.0, 0.04), (0.06, 0.06)])
    async def test_request_start_spacing_includes_rmw_reads(self, monkeypatch, latency, spacing):
        adapter = _adapter({})
        adapter._min_interval = 0.04
        now = [100.0]
        starts = []
        monkeypatch.setattr("adapters.s7.time.monotonic", lambda: now[0])
        monkeypatch.setattr("adapters.s7.time.sleep", lambda seconds: now.__setitem__(0, now[0] + seconds))

        def read(_area, _db, _offset, size):
            starts.append(now[0])
            now[0] += latency
            return bytearray(size)

        def write(*_args):
            starts.append(now[0])
            now[0] += latency

        adapter._plc.read_area.side_effect = read
        adapter._plc.write_area.side_effect = write
        await adapter.stirrer_probe(True)
        assert starts == pytest.approx([100 + i * spacing for i in range(6)])

    @pytest.mark.parametrize("failure_at", range(6))
    async def test_io_error_continues_artisan_tokens_but_reports_failure(self, failure_at):
        adapter = _adapter({})
        calls = []

        def io(kind, db, offset, value):
            calls.append((kind, db, offset))
            if len(calls) - 1 == failure_at:
                raise OSError("test delivery failure")
            return bytearray(value) if kind == "R" else None

        adapter._plc.read_area.side_effect = lambda area, db, offset, size: io("R", db, offset, size)
        adapter._plc.write_area.side_effect = lambda area, db, offset, data: io("W", db, offset, data)
        with pytest.raises(OSError, match="test delivery failure"):
            await adapter.stirrer_probe(True)
        # Failure in an RMW read skips only that write, not the next Artisan token.
        expected = [("R", 2, 30), ("W", 2, 30), ("R", 2, 83), ("W", 2, 83), ("R", 2, 30), ("W", 2, 30)]
        if failure_at % 2 == 0:
            expected.pop(failure_at + 1)
        assert calls == expected
        assert not adapter._io_lock.locked()

    @pytest.mark.parametrize("change_at", [1, 2, 3, 4, 5, 6])
    async def test_session_change_stops_remaining_commands_before_io(self, change_at):
        adapter = _adapter({})
        original = adapter._plc
        replacement = MagicMock()
        waits = 0

        def throttle():
            nonlocal waits
            waits += 1
            if waits == change_at:
                adapter._session += 1
                adapter._plc = replacement

        adapter._throttle = throttle
        with pytest.raises(ConnectionError, match="connection changed"):
            await adapter.stirrer_probe(True)
        assert len(original.mock_calls) == change_at - 1
        assert replacement.mock_calls == []
        assert not adapter._io_lock.locked()

    @pytest.mark.parametrize("change_at", range(6))
    async def test_session_change_during_native_io_aborts_old_and_new_client(self, change_at):
        adapter = _adapter({})
        original = adapter._plc
        replacement = MagicMock()
        calls = 0

        def io(_area, _db, _offset, value):
            nonlocal calls
            if calls == change_at:
                adapter._session += 1
                adapter._plc = replacement
            calls += 1
            return bytearray(value) if isinstance(value, int) else None

        original.read_area.side_effect = io
        original.write_area.side_effect = io
        with pytest.raises(ConnectionError, match="connection changed"):
            await adapter.stirrer_probe(True)
        assert calls == change_at + 1
        assert replacement.mock_calls == []
        assert not adapter._io_lock.locked()

    async def test_short_read_does_not_write_invalid_buffer(self):
        adapter = _adapter({})
        adapter._plc.read_area.side_effect = lambda *args: bytearray()
        with pytest.raises(IOError, match="returned 0 bytes"):
            await adapter.door_probe(1)
        adapter._plc.write_area.assert_not_called()

    async def test_virtual_machine_keeps_the_command(self):
        from adapters.virtual import VirtualMachineAdapter

        adapter = VirtualMachineAdapter()
        await adapter.connect()
        opened = await adapter.door_probe(5)
        assert opened["command_after"] is None
        assert opened["command_held"] is None
        assert opened["discharge_open_after"] is None
        read = await adapter.door_probe(None)
        assert read["command_before"] == 5
        assert read["wrote"] is None
        assert read["discharge_open_after"] is True
        cooled = await adapter.cooling_fan_probe(True)
        assert cooled["command_after"] is None
        assert cooled["cool_fan_after"] is None
        assert cooled["cool_fan_held"] is None
        stirred = await adapter.stirrer_probe(True)
        assert stirred["wrote"] == 7
        assert stirred["command_after"] is None
        assert stirred["stirrer_after"] is None
        fan = await adapter.cooling_fan_probe(None)
        assert fan["cool_fan_after"] is True

    async def test_manager_accepts_the_virtual_machine(self):
        from manager import RoasterManager

        manager = RoasterManager()
        manager._connected = True
        manager._protocol = "virtual"
        manager._roaster_key = "virtual"

        async def fake(write: int | None) -> dict:
            return {
                "wrote": write,
                "command_before": 0,
                "command_after": write or 0,
                "command_held": None if write is None else True,
                "discharge_open_before": False,
                "discharge_open_after": write == 5,
            }

        manager._adapter = SimpleNamespace(door_probe=fake)
        result = await manager.door_probe("discharge_open")
        assert result["action"] == "discharge_open"
        assert result["command_held"] is True

    async def test_manager_rejects_other_roasters(self):
        from manager import RoasterManager

        manager = RoasterManager()
        manager._connected = True
        manager._protocol = "s7"
        manager._roaster_key = "giesen_w6a"
        manager._adapter = object()
        with pytest.raises(ControlUnavailable):
            await manager.door_probe("discharge_open")

    async def test_manager_logs_and_sends_the_probe_result(self, caplog):
        from manager import RoasterManager

        manager = RoasterManager()
        manager._connected = True
        manager._protocol = "s7"
        manager._roaster_key = "giesen_w45a_w60a"

        async def fake(write: int | None) -> dict:
            return {
                "wrote": write,
                "command_before": 0,
                "command_after": 0,
                "command_held": False,
                "discharge_open_before": False,
                "discharge_open_after": False,
            }

        manager._adapter = SimpleNamespace(door_probe=fake)
        scope = MagicMock()
        with (
            caplog.at_level(logging.INFO, logger="manager"),
            patch("manager.sentry_sdk.new_scope") as new_scope,
            patch("manager.sentry_sdk.add_breadcrumb") as breadcrumb,
        ):
            new_scope.return_value.__enter__.return_value = scope
            await manager.door_probe("discharge_open")
        assert "action=discharge_open" in caplog.text
        assert "command 0->0" in caplog.text
        assert "held=False" in caplog.text
        scope.set_context.assert_called_once()
        assert scope.set_context.call_args.args[0] == "door_probe"
        scope.capture_message.assert_called_once_with("w60a door probe", level="warning")
        assert breadcrumb.call_args.kwargs["data"]["discharge_open_after"] is False

    async def test_manager_rejects_unknown_action(self):
        from manager import RoasterManager

        manager = RoasterManager()
        with pytest.raises(ControlRangeError):
            await manager.door_probe("drop")


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
    app = create_app()
    async with TestClient(TestServer(app)) as test_client:
        yield test_client


class TestDoorProbeRoute:
    async def test_returns_the_probe(self, client):
        seen: dict[str, str] = {}

        async def fake(action: str) -> dict:
            seen["action"] = action
            return {"action": action, "wrote": 5, "command_held": True}

        client.server.app["manager"].door_probe = fake
        response = await client.post("/door-probe", json={"action": "discharge_open"})
        assert response.status == 200
        assert seen["action"] == "discharge_open"
        assert (await response.json())["command_held"] is True

    async def test_partial_delivery_runs_remaining_tokens_and_returns_502(self, client):
        adapter = _adapter({})
        store = adapter._plc.write_area.side_effect

        def write(area, db, offset, payload):
            if offset == 83:
                raise OSError("test bit write failure")
            store(area, db, offset, payload)

        adapter._plc.write_area.side_effect = write
        manager = client.server.app["manager"]
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "s7"
        manager._roaster_key = "giesen_w45a_w60a"
        manager._capture_hardware_error = MagicMock()
        response = await client.post("/door-probe", json={"action": "stirrer_on"})
        assert response.status == 502
        body = await response.json()
        assert any(entry["dir"] == "err" and entry["protocol"] == "s7" for entry in body["trace"])
        assert adapter._plc.write_area.call_args.args[1:] == (2, 30, bytearray(2))
        assert manager._capture_hardware_error.call_args.kwargs["traffic"] == body["trace"]
        assert adapter._plc.write_area.call_count == 3
        manager._capture_hardware_error.assert_called_once()

    async def test_missing_action_is_400(self, client):
        response = await client.post("/door-probe", json={})
        assert response.status == 400

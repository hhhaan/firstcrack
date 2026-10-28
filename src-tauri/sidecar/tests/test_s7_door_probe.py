"""W60A door probe reports the command cell and the discharge status bit."""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer
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

    async def test_write_sets_the_two_bytes_just_read(self):
        command = bytearray(b"\x00\x07")
        written: list[bytearray] = []
        adapter = _adapter({})

        def read(_db: int, offset: int, size: int) -> bytearray:
            if offset == 30:
                return command
            return bytearray(size)

        adapter._plc.db_read.side_effect = read
        adapter._plc.db_write.side_effect = lambda _db, _offset, payload: written.append(payload)
        result = await adapter.door_probe(5)
        assert written == [command]
        assert get_int(command, 0) == 5
        assert result["command_before"] == 7
        assert result["command_after"] == 5
        assert adapter._plc.db_write.call_count == 1

    async def test_discharge_open_reports_when_the_command_stays(self):
        adapter = _adapter({(2, 82): bytearray([0])})
        result = await adapter.door_probe(5)
        assert result["wrote"] == 5
        assert result["command_before"] == 0
        assert result["command_after"] == 5
        assert result["command_held"] is True
        assert result["discharge_open_after"] is False

    async def test_reports_when_the_command_does_not_stay(self):
        adapter = _adapter({})
        adapter._plc.db_read.side_effect = lambda db, offset, size: bytearray(size)
        result = await adapter.door_probe(5)
        assert result["command_after"] == 0
        assert result["command_held"] is False

    async def test_virtual_machine_keeps_the_command(self):
        from adapters.virtual import VirtualMachineAdapter

        adapter = VirtualMachineAdapter()
        await adapter.connect()
        opened = await adapter.door_probe(5)
        assert opened["command_after"] == 5
        assert opened["command_held"] is True
        assert opened["discharge_open_after"] is True
        read = await adapter.door_probe(None)
        assert read["command_before"] == 5
        assert read["wrote"] is None

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

    async def test_missing_action_is_400(self, client):
        response = await client.post("/door-probe", json={})
        assert response.status == 400

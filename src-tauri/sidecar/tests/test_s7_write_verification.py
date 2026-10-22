"""#935: a successful S7 write alone must not acknowledge a Giesen heat set."""

import asyncio
import threading
from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from snap7.util.getters import get_int

from adapters.s7 import S7Adapter
from manager import RoasterManager
from control_guard import ControlUnavailable
from roaster_registry import ROASTER_REGISTRY
from tests.test_s7_adapter import _int_bytes


@pytest.fixture
def verified():
    defaults = deepcopy(ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"])
    adapter = S7Adapter(channels=defaults["channels"], write_map=defaults["write_map"])
    adapter._min_interval = 0
    registers = {(2, 14): _int_bytes(36), (2, 48): _int_bytes(20)}
    plc = MagicMock()
    plc.db_write.side_effect = lambda db, offset, payload: registers.update({(db, offset): bytearray(payload)})
    plc.db_read.side_effect = lambda db, offset, size: registers[(db, offset)][:size]
    adapter._plc = plc
    manager = RoasterManager()
    manager._adapter = adapter
    manager._connected = True
    manager._protocol = "s7"
    manager._merged_params = defaults
    manager._last_applied = {"heater": 35}
    return manager, adapter, plc, registers


@pytest.mark.parametrize("requested", [0, 20, 35, 100])
async def test_ack_follows_fresh_command_readback_not_physical_feedback(verified, requested):
    manager, adapter, plc, registers = verified
    calls = []

    def read(db, offset, size):
        calls.append((db, offset))
        assert plc.db_write.call_count == 1
        assert manager.last_applied() == {"heater": 35}
        return registers[(db, offset)][:size]

    plc.db_read.side_effect = read
    assert await manager.control(heater=requested) == {"heater": requested}
    assert manager.last_applied() == {"heater": requested}
    assert calls == [(2, 14)]
    assert get_int(registers[(2, 14)], 0) == requested + 1
    assert get_int(registers[(2, 48)], 0) == 20
    plc.db_write.assert_called_once()


@pytest.mark.parametrize("raw", [0, 8, 21])
async def test_ignored_or_overwritten_zero_does_not_ack_or_retry(verified, raw):
    manager, adapter, plc, registers = verified
    registers[(2, 14)] = _int_bytes(raw)
    plc.db_write.side_effect = None  # transport succeeds but PLC retains AUTO/another setting
    with pytest.raises(IOError, match="설정값 확인 불일치"):
        await manager.control(heater=0)
    assert manager.last_applied() == {"heater": 35}
    plc.db_write.assert_called_once()
    assert get_int(plc.db_write.call_args.args[2], 0) == 1
    plc.db_read.assert_called_once_with(2, 14, 2)


async def test_retry_confirms_a_write_whose_acknowledgement_was_lost(verified):
    manager, adapter, plc, registers = verified
    plc.db_read.side_effect = TimeoutError("read acknowledgement lost")
    with pytest.raises(TimeoutError):
        await manager.control(heater=0)
    assert get_int(registers[(2, 14)], 0) == 1
    plc.db_read.side_effect = lambda db, offset, size: registers[(db, offset)][:size]
    assert await manager.control(heater=0, retry_epoch=0) == {"heater": 0}
    plc.db_write.assert_called_once()
    assert manager.last_applied() == {"heater": 0}


async def test_retry_resends_only_after_a_fresh_mismatch_and_confirms_again(verified):
    manager, adapter, plc, registers = verified
    plc.db_write.side_effect = None
    with pytest.raises(IOError):
        await manager.control(heater=0)
    plc.db_write.side_effect = lambda db, offset, payload: registers.update({(db, offset): bytearray(payload)})
    plc.db_read.reset_mock()
    assert await manager.control(heater=0, retry_epoch=0) == {"heater": 0}
    assert plc.db_write.call_count == 2
    assert plc.db_read.call_count == 2
    assert get_int(registers[(2, 14)], 0) == 1


async def test_retry_budget_is_enforced_by_the_sidecar_too(verified):
    manager, adapter, plc, registers = verified
    plc.db_write.side_effect = None
    for retry_epoch in (None, 0, 0):
        with pytest.raises(IOError):
            await manager.control(heater=0, retry_epoch=retry_epoch)
    with pytest.raises(ControlUnavailable):
        await manager.control(heater=0, retry_epoch=0)
    assert plc.db_write.call_count == 3
    assert manager.last_applied() == {"heater": 35}


async def test_unreadable_command_is_checked_again_without_blind_resend(verified):
    manager, adapter, plc, registers = verified
    plc.db_read.side_effect = TimeoutError("PLC read unavailable")
    for retry_epoch in (None, 0, 0):
        with pytest.raises(TimeoutError):
            await manager.control(heater=0, retry_epoch=retry_epoch)
    plc.db_write.assert_called_once()
    assert plc.db_read.call_count == 3


@pytest.mark.parametrize("boundary", ["manual", "connection", "pid", "reset"])
async def test_retry_cannot_override_an_intervening_owner(verified, boundary):
    manager, adapter, plc, registers = verified
    plc.db_write.side_effect = None
    with pytest.raises(IOError):
        await manager.control(heater=0)
    if boundary == "manual":
        plc.db_write.side_effect = lambda db, offset, payload: registers.update({(db, offset): bytearray(payload)})
        await manager.control(heater=20)
    elif boundary == "connection":
        manager._connection_epoch += 1
    elif boundary == "pid":
        manager._pid = MagicMock()
        manager._pid.state.return_value = {"state": "running"}
    else:
        manager._resetting = True
    sent = plc.db_write.call_count
    with pytest.raises(ControlUnavailable):
        await manager.control(heater=0, retry_epoch=0)
    assert plc.db_write.call_count == sent


async def test_owner_change_during_retry_preflight_prevents_resend(verified):
    manager, adapter, plc, registers = verified
    plc.db_write.side_effect = None
    with pytest.raises(IOError):
        await manager.control(heater=0)

    def preflight(db, offset, size):
        manager._heater_command_version += 1
        return registers[(db, offset)][:size]

    plc.db_read.side_effect = preflight
    with pytest.raises(ConnectionError, match="제어권이 변경"):
        await manager.control(heater=0, retry_epoch=0)
    plc.db_write.assert_called_once()


@pytest.mark.parametrize("bad", [bytearray(), bytearray([1]), bytearray([0, 1, 0]), TimeoutError("PLC timeout")])
async def test_unavailable_or_malformed_readback_does_not_ack_or_retry(verified, bad):
    manager, adapter, plc, registers = verified
    if isinstance(bad, Exception):
        plc.db_read.side_effect = bad
    else:
        plc.db_read.side_effect = None
        plc.db_read.return_value = bad
    with pytest.raises((IOError, TimeoutError)):
        await manager.control(heater=0)
    assert manager.last_applied() == {"heater": 35}
    plc.db_write.assert_called_once()
    plc.db_read.assert_called_once_with(2, 14, 2)


async def test_late_readback_after_connection_change_is_not_acknowledged(verified):
    manager, adapter, plc, registers = verified

    def read(db, offset, size):
        adapter._session += 1
        adapter._plc = MagicMock()
        return registers[(db, offset)][:size]

    plc.db_read.side_effect = read
    with pytest.raises(ConnectionError, match="연결이 변경"):
        await manager.control(heater=0)
    assert manager.last_applied() == {"heater": 35}
    adapter._plc.db_write.assert_not_called()


async def test_old_command_waiting_for_io_lock_cannot_write_to_new_connection(verified):
    manager, adapter, plc, registers = verified
    lock = threading.Lock()
    lock.acquire()
    waiting = threading.Event()

    def acquire(*, timeout):
        waiting.set()
        return lock.acquire(timeout=timeout)

    adapter._io_lock = MagicMock()
    adapter._io_lock.acquire.side_effect = acquire
    adapter._io_lock.release.side_effect = lock.release
    task = asyncio.create_task(manager.control(heater=0))
    try:
        assert await asyncio.to_thread(waiting.wait, 1)
        adapter._session += 1
        adapter._plc = MagicMock()
    finally:
        lock.release()
    with pytest.raises(ConnectionError, match="연결이 변경"):
        await task
    plc.db_write.assert_not_called()
    adapter._plc.db_write.assert_not_called()
    assert manager.last_applied() == {"heater": 35}

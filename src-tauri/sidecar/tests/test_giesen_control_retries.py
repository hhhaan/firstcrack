"""Delivery acknowledgements must not depend on fan/drum acceleration."""

from copy import deepcopy
from unittest.mock import MagicMock

import pytest

from adapters.s7 import S7Adapter
from control_guard import ControlUnavailable
from manager import RoasterManager, _merge_connect_params
from roaster_registry import ROASTER_REGISTRY
from tests.test_s7_adapter import _int_bytes


@pytest.fixture(params=["giesen_w1", "giesen_w45a_w60a"])
def machine(request):
    params = deepcopy(ROASTER_REGISTRY[request.param]["default_params"])
    adapter = S7Adapter(**params)
    adapter._min_interval = 0
    registers = {(2, 14): _int_bytes(36), (2, 16): _int_bytes(110),
                 (2, 18): _int_bytes(45), (2, 52): _int_bytes(80), (2, 54): _int_bytes(60)}
    plc = MagicMock()
    plc.db_write.side_effect = lambda db, offset, data: registers.update({(db, offset): bytearray(data)})
    plc.db_read.side_effect = lambda db, offset, size: registers[(db, offset)][:size]
    adapter._plc = plc
    manager = RoasterManager()
    manager._adapter, manager._merged_params = adapter, params
    manager._connected, manager._protocol = True, "s7"
    return manager, plc, registers


async def test_airflow_ack_uses_command_cell_while_pressure_is_still_ramping(machine):
    manager, plc, registers = machine
    assert await manager.control(fan=120) == {"fan": 120}
    plc.db_read.assert_called_once_with(2, 16, 2)
    assert registers[(2, 52)] == _int_bytes(80)
    assert registers[(2, 54)] == _int_bytes(60)


async def test_successful_drum_write_does_not_require_immediate_feedback_convergence(machine):
    manager, plc, registers = machine
    # Model firmware that reports a value which has not reached its target yet.
    plc.db_write.side_effect = None
    assert await manager.control(drum=50) == {"drum": 50}
    assert registers[(2, 18)] == _int_bytes(45)
    assert manager.last_applied() == {"drum": 50}
    plc.db_write.assert_called_once_with(2, 18, _int_bytes(50))
    plc.db_read.assert_not_called()


async def test_lost_write_ack_is_recovered_without_a_duplicate_write(machine):
    manager, plc, registers = machine

    def write(db, offset, data):
        registers[(db, offset)] = bytearray(data)
        raise TimeoutError("write acknowledgement lost")

    plc.db_write.side_effect = write
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)
    assert await manager.control(fan=120, retry_epoch=0) == {"fan": 120}
    plc.db_write.assert_called_once()
    plc.db_read.assert_called_once_with(2, 16, 2)


async def test_failed_delivery_is_retried_only_after_reading_the_airflow_command_cell(machine):
    manager, plc, registers = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)
    plc.db_write.side_effect = lambda db, offset, data: registers.update({(db, offset): bytearray(data)})
    assert await manager.control(fan=120, retry_epoch=0) == {"fan": 120}
    assert plc.db_write.call_count == 2
    assert [(c.args[0], c.args[1]) for c in plc.db_read.call_args_list] == [(2, 16), (2, 16)]


async def test_ignored_airflow_command_is_not_acknowledged(machine):
    manager, plc, _ = machine
    plc.db_write.side_effect = None  # PLC ignores the setting although transport succeeds.
    with pytest.raises(IOError, match="설정값 확인 불일치"):
        await manager.control(fan=120)
    assert manager.last_applied() == {}
    plc.db_write.assert_called_once()


@pytest.mark.parametrize("bad_read", [TimeoutError("read unavailable"), bytearray(), bytearray([0])])
async def test_unreadable_or_truncated_preflight_never_permits_a_blind_resend(machine, bad_read):
    manager, plc, _ = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)
    plc.db_read.side_effect = bad_read if isinstance(bad_read, Exception) else None
    plc.db_read.return_value = bad_read
    for _ in range(2):
        with pytest.raises(IOError):
            await manager.control(fan=120, retry_epoch=0)
    plc.db_write.assert_called_once()


async def test_airflow_has_a_bounded_retry_budget(machine):
    manager, plc, _ = machine
    plc.db_write.side_effect = TimeoutError("write unavailable")
    for epoch in (None, 0, 0):
        with pytest.raises(TimeoutError):
            await manager.control(fan=120, retry_epoch=epoch)
    with pytest.raises(ControlUnavailable):
        await manager.control(fan=120, retry_epoch=0)
    assert plc.db_write.call_count == 3


@pytest.mark.parametrize("boundary", ["new_value", "connection", "reset"])
async def test_stale_airflow_retry_is_rejected_without_writing(machine, boundary):
    manager, plc, registers = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)
    plc.db_write.side_effect = lambda db, offset, data: registers.update({(db, offset): bytearray(data)})
    if boundary == "new_value":
        await manager.control(fan=125)
    elif boundary == "connection":
        manager._connection_epoch += 1
    else:
        manager._resetting = True
    count = plc.db_write.call_count
    with pytest.raises(ControlUnavailable):
        await manager.control(fan=120, retry_epoch=0)
    assert plc.db_write.call_count == count


async def test_new_command_during_preflight_prevents_old_resend(machine):
    manager, plc, registers = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)

    def read(db, offset, size):
        manager._control_versions["fan"] += 1
        return registers[(db, offset)][:size]

    plc.db_read.side_effect = read
    with pytest.raises(ConnectionError, match="제어권이 변경"):
        await manager.control(fan=120, retry_epoch=0)
    plc.db_write.assert_called_once()


async def test_pid_heat_and_another_role_do_not_take_ownership_of_airflow(machine):
    manager, plc, registers = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120)
    plc.db_write.side_effect = lambda db, offset, data: registers.update({(db, offset): bytearray(data)})
    manager._pid = MagicMock()
    manager._pid.state.return_value = {"state": "running"}
    await manager.control(heater=40, drum=50)
    assert await manager.control(fan=120, retry_epoch=0) == {"fan": 120}


async def test_mixed_and_unverified_airflow_retries_are_rejected(machine):
    manager, plc, _ = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(fan=120, drum=50)
    with pytest.raises(ControlUnavailable):
        await manager.control(fan=120, drum=50, retry_epoch=0)
    manager._merged_params["write_map"]["fan"].pop("verify_readback")
    with pytest.raises(ControlUnavailable):
        await manager.control(fan=120, retry_epoch=0)
    plc.db_write.assert_called_once()


async def test_drum_failure_does_not_enable_a_guarded_retry(machine):
    manager, plc, _ = machine
    plc.db_write.side_effect = TimeoutError("write lost")
    with pytest.raises(TimeoutError):
        await manager.control(drum=50)
    with pytest.raises(ControlUnavailable):
        await manager.control(drum=50, retry_epoch=0)
    plc.db_write.assert_called_once()


@pytest.mark.parametrize("key", ["giesen_w1", "giesen_w45a_w60a"])
@pytest.mark.parametrize("custom", [None, "offset", "min", "unit", "explicit_opt_out"])
def test_saved_airflow_maps_gain_retries_only_when_the_whole_map_matches_the_factory(key, custom):
    defaults = ROASTER_REGISTRY[key]["default_params"]
    saved = deepcopy(defaults["write_map"])
    saved["fan"].pop("verify_readback")
    if custom == "explicit_opt_out":
        saved["fan"]["verify_readback"] = False
    elif custom:
        saved["fan"][custom] = {"offset": 98, "min": 105, "unit": "%"}[custom]
    before = deepcopy(saved)
    merged = _merge_connect_params(defaults, {"write_map": saved})
    assert merged["write_map"] == (saved if custom else defaults["write_map"])
    assert saved == before

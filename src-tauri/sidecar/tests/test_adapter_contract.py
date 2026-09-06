"""#381: adapter writable 계약. 매니저는 프로토콜 문자열 집합과 hasattr를 보지 않는다."""
import pytest

import adapters
import manager as manager_mod
from adapters import _PROTOCOL_ADAPTER
from adapters.kaleido import KaleidoAdapter
from adapters.modbus import ModbusAdapter
from adapters.phidget import PhidgetAdapter
from adapters.probat_ws import ProbatWSAdapter
from adapters.s7 import S7Adapter
from adapters.virtual import VirtualMachineAdapter
from control_guard import ControlUnavailable

_CLIENT_WRITE_MAP = {"heater": {"min": 0, "max": 100, "unit": "%"}}

STUB_ADAPTERS = (KaleidoAdapter, ModbusAdapter, PhidgetAdapter, ProbatWSAdapter)
WRITABLE_ADAPTERS = (S7Adapter, VirtualMachineAdapter)


def test_writable_protocols_set_is_gone():
    assert not hasattr(adapters, "WRITABLE_PROTOCOLS")
    assert not hasattr(manager_mod, "WRITABLE_PROTOCOLS")
    assert not hasattr(manager_mod, "_format_connection_error")


def test_stub_adapters_have_control_but_are_not_writable():
    for cls in STUB_ADAPTERS:
        assert cls.writable is False
        assert callable(cls.control)


def test_s7_and_virtual_are_writable():
    for cls in WRITABLE_ADAPTERS:
        assert cls.writable is True


def test_every_registered_adapter_declares_writable():
    for protocol, cls in _PROTOCOL_ADAPTER.items():
        assert isinstance(cls.writable, bool), protocol


def test_writable_follows_adapter_flag_not_protocol_name(manager):
    class FlagOn:
        writable = True

    class FlagOff:
        writable = False

    manager._connected = True
    manager._merged_params = {"write_map": _CLIENT_WRITE_MAP}

    manager._adapter = FlagOn()
    manager._protocol = "kaleido"
    assert manager._control_writable() is True

    manager._adapter = FlagOff()
    manager._protocol = "s7"
    assert manager._control_writable() is False


async def test_control_rejects_stub_even_if_protocol_looks_writable(manager):
    manager._adapter = KaleidoAdapter()
    manager._connected = True
    manager._protocol = "s7"
    manager._merged_params = {"write_map": _CLIENT_WRITE_MAP}
    with pytest.raises(ControlUnavailable):
        await manager.control(heater=50)


async def test_enter_standby_and_start_roast_are_contract_noops(manager):
    manager._adapter = KaleidoAdapter()
    manager._connected = True
    await manager.enter_standby()
    await manager.start_roast()


def test_s7_formats_connection_refused():
    adapter = S7Adapter(host="10.0.0.1", port=102)
    msg = adapter.format_connection_error(ConnectionRefusedError("Connection refused"))
    assert "PLC(10.0.0.1:102)" in msg


def test_modbus_first_read_failure_is_adapter_owned():
    serial = ModbusAdapter(mode="rtu")
    assert "연결 방식(RTU/ASCII)" in serial.format_connection_error(
        RuntimeError("no more readings"), first_read_failure=True
    )
    tcp = ModbusAdapter(mode="tcp")
    assert "Unit ID" in tcp.format_connection_error(
        RuntimeError("no more readings"), first_read_failure=True
    )


def test_phidget_formats_missing_sdk():
    adapter = PhidgetAdapter()
    msg = adapter.format_connection_error(
        ModuleNotFoundError("No module named 'Phidget22'")
    )
    assert "Phidget22 SDK" in msg

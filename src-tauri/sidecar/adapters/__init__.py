from adapters.base import MachineAdapter, Reading
from adapters.virtual import VirtualMachineAdapter
from adapters.kaleido import KaleidoAdapter
from adapters.s7 import S7Adapter
from adapters.modbus import ModbusAdapter
from adapters.probat_ws import ProbatWSAdapter
from adapters.phidget import PhidgetAdapter
from typing import Any

_PROTOCOL_ADAPTER: dict[str, type[MachineAdapter]] = {
    "virtual": VirtualMachineAdapter,
    "kaleido": KaleidoAdapter,
    "s7": S7Adapter,
    "modbus": ModbusAdapter,
    "probat_ws": ProbatWSAdapter,
    "phidget": PhidgetAdapter,
}


def make_adapter(protocol: str, params: dict[str, Any]) -> MachineAdapter:
    cls = _PROTOCOL_ADAPTER.get(protocol)
    if cls is None:
        raise ValueError(f"지원하지 않는 프로토콜: {protocol}")
    return cls(**params)

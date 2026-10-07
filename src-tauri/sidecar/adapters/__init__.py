from adapters.base import Reading
from adapters.virtual import VirtualMachineAdapter
from adapters.kaleido import KaleidoAdapter
from adapters.s7 import S7Adapter
from adapters.modbus import ModbusAdapter
from adapters.probat_ws import ProbatWSAdapter
from adapters.phidget import PhidgetAdapter
from adapters.ikawa_ble import IkawaBleAdapter
from typing import Any

_PROTOCOL_ADAPTER: dict[str, type] = {
    "virtual": VirtualMachineAdapter,
    "kaleido": KaleidoAdapter,
    "s7": S7Adapter,
    "modbus": ModbusAdapter,
    "probat_ws": ProbatWSAdapter,
    "phidget": PhidgetAdapter,
    "ikawa_ble": IkawaBleAdapter,
}

# control()이 실제로 하드웨어에 쓰는 프로토콜. hasattr(adapter, "control")는
# 스텁에도 항상 True라 쓰기 가능 여부로 쓸 수 없다 (#270).
WRITABLE_PROTOCOLS = frozenset({"s7", "virtual"})


def make_adapter(protocol: str, params: dict[str, Any]) -> Any:
    cls = _PROTOCOL_ADAPTER.get(protocol)
    if cls is None:
        raise ValueError(f"지원하지 않는 프로토콜: {protocol}")
    return cls(**params)

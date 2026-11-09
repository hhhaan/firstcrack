import asyncio
import logging
import threading
import time
from typing import Any

from adapters.base import Reading
from control_guard import ControlUnavailable

_log = logging.getLogger(__name__)
_CHANNEL_MAX = {"TMP1101": 3, "1048": 3, "TMP1200": 0, "TMP1202": 0}
_RTD_TYPES = {"PT100_3850", "PT100_3920", "PT1000_3850", "PT1000_3920"}
# Device ID, serial (hub serial for VINT), hub port, temperature channel.
_Address = tuple[int, int, int, int]


class PhidgetAdapter:
    """Local Phidget22 temperature channels; BT is required and ET is optional."""

    _ATTACH_TIMEOUT_MS = 5000
    # shortcut: callbacks arriving after 1s need reconnect; extend discovery if slow hubs require it.
    _DISCOVERY_SECONDS = 1.0

    def __init__(
        self,
        device_type: str = "TMP1101",
        channel_bt: int = 0,
        channel_et: int | None = 1,
        serial_number: int | None = None,
        **params: Any,
    ) -> None:
        self._roles: dict[str, dict[str, Any]] = {}
        for role, channel in (("bt", channel_bt), ("et", channel_et)):
            if channel is None and role == "et":
                continue
            model = params.get(f"{role}_device_type", device_type)
            if model is None:
                model = device_type
            serial = params.get(f"{role}_serial_number", serial_number)
            hub_port = params.get(f"{role}_hub_port")
            tc = params.get(f"{role}_thermocouple_type", "K")
            rtd = params.get(f"{role}_rtd_type", "PT1000_3850")
            wire = params.get(f"{role}_rtd_wire_setup")
            if wire is None:
                wire = 4
            if not isinstance(model, str) or model not in _CHANNEL_MAX:
                raise ValueError(f"Phidget {role.upper()}: 지원하지 않는 모델입니다.")
            if type(channel) is not int or not 0 <= channel <= _CHANNEL_MAX[model]:
                raise ValueError(f"Phidget {role.upper()}: {model} 채널은 0–{_CHANNEL_MAX[model]} 정수여야 합니다.")
            if serial is not None and (type(serial) is not int or not 0 < serial <= 2147483647):
                raise ValueError(f"Phidget {role.upper()}: serial은 양의 정수여야 합니다.")
            if hub_port is not None and (type(hub_port) is not int or not 0 <= hub_port <= 5):
                raise ValueError(f"Phidget {role.upper()}: hub port는 0–5 정수여야 합니다.")
            if model == "1048" and hub_port is not None:
                raise ValueError(f"Phidget {role.upper()}: USB 1048에는 hub port를 지정하지 않습니다.")
            if not isinstance(tc, str) or tc not in {"K", "J", "E", "T"} or not isinstance(rtd, str) or rtd not in _RTD_TYPES:
                raise ValueError(f"Phidget {role.upper()}: 지원하지 않는 프로브 종류입니다.")
            if type(wire) is not int or wire not in (2, 3, 4):
                raise ValueError(f"Phidget {role.upper()}: RTD 배선은 2, 3, 4선이어야 합니다.")
            self._roles[role] = dict(model=model, channel=channel, serial=serial, hub_port=hub_port,
                                     thermocouple_type=tc, rtd_type=rtd, rtd_wire_setup=wire)
        self._addresses: dict[str, _Address] = {}
        self._sensor_bt: Any = None
        self._sensor_et: Any = None
        self._connected = False
        self._session = 0
        self._state_lock = threading.Lock()
        self._cancel = threading.Event()

    @staticmethod
    def _address(sensor: Any) -> _Address:
        return (sensor.getDeviceID(), sensor.getDeviceSerialNumber(), sensor.getHubPort(), sensor.getChannel())

    def _discover(self, cancel: threading.Event) -> set[_Address]:
        from Phidget22.ChannelClass import ChannelClass  # type: ignore[import]
        from Phidget22.Devices.Manager import Manager  # type: ignore[import]

        addresses: set[_Address] = set()
        lock = threading.Lock()

        def attached(_manager: Any, channel: Any) -> None:
            try:
                if channel.getChannelClass() == ChannelClass.PHIDCHCLASS_TEMPERATURESENSOR and not channel.getIsRemote():
                    with lock:
                        addresses.add(self._address(channel))
            except Exception:
                _log.warning("Phidget discovery channel unavailable", exc_info=True)

        def detached(_manager: Any, channel: Any) -> None:
            try:
                with lock:
                    addresses.discard(self._address(channel))
            except Exception:
                _log.warning("Phidget discovery detach unavailable", exc_info=True)

        manager = Manager()
        try:
            manager.setOnAttachHandler(attached)
            manager.setOnDetachHandler(detached)
            manager.open()
            # Manager emits existing channels asynchronously; collect before selecting.
            if cancel.wait(self._DISCOVERY_SECONDS):
                raise ConnectionError("Phidget 연결 시도가 취소되었습니다.")
            with lock:
                return addresses.copy()
        finally:
            manager.close()

    def _resolve_addresses(self, available: set[_Address]) -> dict[str, _Address]:
        from Phidget22.DeviceID import DeviceID  # type: ignore[import]

        resolved = {}
        for role, config in self._roles.items():
            if role in self._addresses:
                resolved[role] = self._addresses[role]
                continue
            device_id = getattr(DeviceID, f"PHIDID_{config['model']}")
            matches = {address for address in available
                       if address[0] == device_id and address[3] == config["channel"]
                       and (config["serial"] is None or address[1] == config["serial"])
                       and (config["hub_port"] is None or address[2] == config["hub_port"])}
            if not matches:
                raise ConnectionError(f"Phidget {role.upper()} {config['model']} 채널을 찾을 수 없습니다. Control Panel에서 모델·serial·hub port·채널을 확인하세요.")
            if len(matches) != 1:
                raise ConnectionError(f"Phidget {role.upper()}에 일치하는 장치가 여러 개입니다. serial과 hub port를 지정하세요.")
            resolved[role] = matches.pop()
        if resolved.get("bt") == resolved.get("et"):
            raise ValueError("Phidget BT와 ET는 서로 다른 센서 채널이어야 합니다.")
        return resolved

    def _configure_sensor(self, sensor: Any, role: str, address: _Address) -> None:
        from Phidget22.RTDType import RTDType  # type: ignore[import]
        from Phidget22.RTDWireSetup import RTDWireSetup  # type: ignore[import]
        from Phidget22.ThermocoupleType import ThermocoupleType  # type: ignore[import]

        if self._address(sensor) != address:
            raise ConnectionError(f"Phidget {role.upper()} 장치가 선택한 모델/주소와 다릅니다.")
        config = self._roles[role]
        if config["model"] in ("1048", "TMP1101"):
            sensor.setThermocoupleType(getattr(ThermocoupleType, f"THERMOCOUPLE_TYPE_{config['thermocouple_type']}"))
        else:
            sensor.setRTDType(getattr(RTDType, f"RTD_TYPE_{config['rtd_type']}"))
            sensor.setRTDWireSetup(getattr(RTDWireSetup, f"RTD_WIRE_SETUP_{config['rtd_wire_setup']}WIRE"))

    def _make_sensor(self, role: str, address: _Address) -> Any:
        from Phidget22.Devices.TemperatureSensor import TemperatureSensor  # type: ignore[import]

        sensor = TemperatureSensor()
        try:
            sensor.setDeviceSerialNumber(address[1])
            if self._roles[role]["model"] != "1048":
                sensor.setHubPort(address[2])
            sensor.setChannel(address[3])
            sensor.setIsLocal(True)
            sensor.setIsRemote(False)
            sensor._fc_configuration_error = None

            def attached(channel: Any) -> None:
                try:
                    self._configure_sensor(channel, role, address)
                    channel._fc_configuration_error = None
                except Exception as exc:
                    channel._fc_configuration_error = exc

            sensor.setOnAttachHandler(attached)
            return sensor
        except BaseException:
            self._close_quietly(sensor)
            raise

    @staticmethod
    def _wait_for_temperature(sensor: Any, cancel: threading.Event) -> None:
        from Phidget22.ErrorCode import ErrorCode  # type: ignore[import]

        deadline = time.monotonic() + 1.0
        while True:
            if cancel.is_set():
                raise ConnectionError("Phidget 연결 시도가 취소되었습니다.")
            try:
                sensor.getTemperature()
                return
            except Exception as exc:
                # Attachment can precede the first conversion; other errors fail immediately.
                if getattr(exc, "code", None) != ErrorCode.EPHIDGET_UNKNOWNVAL or time.monotonic() >= deadline:
                    raise
                cancel.wait(0.05)

    @staticmethod
    def _close_quietly(*sensors: Any) -> None:
        for sensor in sensors:
            if sensor is not None:
                try:
                    sensor.close()
                except Exception:
                    _log.exception("Phidget sensor close failed")

    async def connect(self) -> None:
        with self._state_lock:
            session = self._session
            cancel = self._cancel

        def open_sensors() -> None:
            sensors: dict[str, Any] = {}
            try:
                addresses = self._resolve_addresses(self._discover(cancel))
                for role, address in addresses.items():
                    if cancel.is_set():
                        raise ConnectionError("Phidget 연결 시도가 취소되었습니다.")
                    sensor = self._make_sensor(role, address)
                    sensors[role] = sensor
                    sensor.openWaitForAttachment(self._ATTACH_TIMEOUT_MS)
                    self._configure_sensor(sensor, role, address)
                    self._wait_for_temperature(sensor, cancel)
                # Bind in the executor: a cancelled await may never resume (#208).
                with self._state_lock:
                    if session != self._session or cancel.is_set():
                        raise ConnectionError("Phidget 연결 시도가 취소되었습니다.")
                    self._sensor_bt = sensors["bt"]
                    self._sensor_et = sensors.get("et")
                    self._addresses = addresses
                    self._connected = True
            except BaseException:
                self._close_quietly(*sensors.values())
                raise

        try:
            await asyncio.get_running_loop().run_in_executor(None, open_sensors)
        except asyncio.CancelledError:
            await self.disconnect()
            raise

    async def disconnect(self) -> None:
        with self._state_lock:
            self._session += 1
            self._cancel.set()
            self._cancel = threading.Event()
            self._connected = False
            sensors = (self._sensor_bt, self._sensor_et)
            self._sensor_bt = None
            self._sensor_et = None
        await asyncio.get_running_loop().run_in_executor(None, self._close_quietly, *sensors)

    async def read(self) -> Reading:
        bt_sensor, et_sensor = self._sensor_bt, self._sensor_et
        if bt_sensor is None:
            raise ConnectionError("Phidget 센서가 연결되지 않음")

        def temperature(sensor: Any) -> float:
            error = getattr(sensor, "_fc_configuration_error", None)
            if isinstance(error, Exception):
                raise error
            return round(float(sensor.getTemperature()), 1)

        def read_temps() -> tuple[float, float]:
            bt = temperature(bt_sensor)
            try:
                et = temperature(et_sensor) if et_sensor is not None else -1.0
            except Exception:
                et = -1.0
            return bt, et

        bt, et = await asyncio.get_running_loop().run_in_executor(None, read_temps)
        return Reading(bt=bt, et=et, heater=None, fan=None, drum=None, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._connected

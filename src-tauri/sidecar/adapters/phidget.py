import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)


class PhidgetAdapter:
    """
    Phidget USB 온도 센서 어댑터 (TMP1101, TMP1200, 1048 등).
    Phidget22 Python SDK 직접 사용.

    주의: pip install Phidget22 외에도 시스템 드라이버 설치 필요.
      macOS: https://www.phidgets.com/docs/OS_-_macOS

    device_type: "TMP1101" | "TMP1200" | "TMP1202" | "1048"
    channel_bt:  BT 채널 인덱스 (0-3)
    channel_et:  ET 채널 인덱스 (0-3), None이면 ET 미사용
    serial_number: 여러 Phidget 연결 시 특정 장치 지정. None이면 아무거나.
    """

    _ATTACH_TIMEOUT_MS = 5000

    def __init__(
        self,
        device_type: str = "TMP1101",
        channel_bt: int = 0,
        channel_et: int | None = 1,
        serial_number: int | None = None,
        **_: Any,
    ) -> None:
        self._device_type = device_type
        self._channel_bt = channel_bt
        self._channel_et = channel_et
        self._serial_number = serial_number
        self._sensor_bt: Any = None
        self._sensor_et: Any = None
        self._connected: bool = False

    def _make_sensor(self, channel: int) -> Any:
        from Phidget22.Devices.TemperatureSensor import TemperatureSensor  # type: ignore[import]
        sensor = TemperatureSensor()
        sensor.setChannel(channel)
        if self._serial_number is not None:
            sensor.setDeviceSerialNumber(self._serial_number)
        return sensor

    async def connect(self) -> None:
        def _open_sensors() -> None:
            self._sensor_bt = self._make_sensor(self._channel_bt)
            self._sensor_bt.openWaitForAttachment(self._ATTACH_TIMEOUT_MS)
            if self._channel_et is not None:
                self._sensor_et = self._make_sensor(self._channel_et)
                self._sensor_et.openWaitForAttachment(self._ATTACH_TIMEOUT_MS)

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _open_sensors)
        self._connected = True
        _log.info("PhidgetAdapter connected: device=%s BT_ch=%d ET_ch=%s serial=%s",
                  self._device_type, self._channel_bt, self._channel_et, self._serial_number)

    async def disconnect(self) -> None:
        def _close_sensors() -> None:
            for sensor in (self._sensor_bt, self._sensor_et):
                if sensor is not None:
                    try:
                        sensor.close()
                    except Exception:
                        pass
            self._sensor_bt = None
            self._sensor_et = None

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _close_sensors)
        self._connected = False

    async def read(self) -> Reading:
        if self._sensor_bt is None:
            raise ConnectionError("Phidget 센서가 연결되지 않음")

        def _read_temps() -> tuple[float, float]:
            try:
                bt = round(float(self._sensor_bt.getTemperature()), 1)
            except Exception:
                bt = -1.0
            try:
                et = round(float(self._sensor_et.getTemperature()), 1) if self._sensor_et else -1.0
            except Exception:
                et = -1.0
            return bt, et

        loop = asyncio.get_running_loop()
        bt, et = await loop.run_in_executor(None, _read_temps)
        return Reading(bt=bt, et=et, heater=0.0, fan=0.0, drum=0.0, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        pass  # 온도 센서는 읽기 전용

    @property
    def connected(self) -> bool:
        return self._connected

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
        # 세션 에폭. disconnect마다 +1 — openWaitForAttachment(5s)는 중단 불가라
        # 취소된 연결 시도가 executor 스레드에서 뒤늦게 완료될 수 있다. 바인딩
        # 직전 에폭이 다르면 열린 센서를 닫고 버린다 (#208).
        self._session: int = 0

    def _make_sensor(self, channel: int) -> Any:
        from Phidget22.Devices.TemperatureSensor import TemperatureSensor  # type: ignore[import]
        sensor = TemperatureSensor()
        sensor.setChannel(channel)
        if self._serial_number is not None:
            sensor.setDeviceSerialNumber(self._serial_number)
        return sensor

    @staticmethod
    def _close_quietly(*sensors: Any) -> None:
        for sensor in sensors:
            if sensor is not None:
                try:
                    sensor.close()
                except Exception:
                    pass

    async def connect(self) -> None:
        session = self._session

        def _open_sensors() -> None:
            bt = self._make_sensor(self._channel_bt)
            bt.openWaitForAttachment(self._ATTACH_TIMEOUT_MS)
            et = None
            if self._channel_et is not None:
                et = self._make_sensor(self._channel_et)
                et.openWaitForAttachment(self._ATTACH_TIMEOUT_MS)
            # 에폭 검사와 바인딩은 반드시 이 스레드 안에서 — await 뒤에 두면
            # 취소된 코루틴이 재개되지 않아 열린 센서 핸들이 그대로 샌다 (#208).
            if session != self._session:
                self._close_quietly(bt, et)
                raise ConnectionError("연결 시도가 취소되었습니다.")
            self._sensor_bt = bt
            self._sensor_et = et
            self._connected = True

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _open_sensors)
        _log.info("PhidgetAdapter connected: device=%s BT_ch=%d ET_ch=%s serial=%s",
                  self._device_type, self._channel_bt, self._channel_et, self._serial_number)

    async def disconnect(self) -> None:
        # 에폭 +1을 먼저 — 진행 중인 connect가 뒤늦게 완료돼도 바인딩되지 않는다.
        self._session += 1
        self._connected = False

        def _close_sensors() -> None:
            self._close_quietly(self._sensor_bt, self._sensor_et)
            self._sensor_bt = None
            self._sensor_et = None

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _close_sensors)
        self._connected = False

    async def read(self) -> Reading:
        if self._sensor_bt is None:
            raise ConnectionError("Phidget 센서가 연결되지 않음")

        def _read_temps() -> tuple[float, float]:
            # BT는 필수 채널 — 예외를 삼키지 않고 그대로 전파해야 manager의
            # stale/재연결 계약이 작동한다. 삼키면 USB 분리 후에도 직전 EMA가
            # 정상 온도처럼 계속 표시된다 (H1).
            bt = round(float(self._sensor_bt.getTemperature()), 1)
            try:
                et = round(float(self._sensor_et.getTemperature()), 1) if self._sensor_et else -1.0
            except Exception:
                et = -1.0  # ET는 선택 채널 — soft-fail로 두어 로스팅을 계속한다
            return bt, et

        loop = asyncio.get_running_loop()
        bt, et = await loop.run_in_executor(None, _read_temps)
        return Reading(bt=bt, et=et, heater=0.0, fan=0.0, drum=0.0, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        pass  # 제어 기능 미사용 — 제거 예정

    @property
    def connected(self) -> bool:
        return self._connected

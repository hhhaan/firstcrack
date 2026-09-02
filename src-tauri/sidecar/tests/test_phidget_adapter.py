"""Tests for PhidgetAdapter read contract (H1).

핵심 계약: BT 읽기 실패는 예외로 전파돼야 manager의 stale/재연결 경로가 작동한다.
ET는 선택 채널이라 실패해도 -1.0 soft-fail로 로스팅을 계속한다.
"""
import unittest.mock as mock

import pytest

from adapters.phidget import PhidgetAdapter


def _sensor(value: float | None = None, exc: Exception | None = None):
    s = mock.MagicMock()
    if exc is not None:
        s.getTemperature.side_effect = exc
    else:
        s.getTemperature.return_value = value
    return s


class TestPhidgetRead:
    async def test_bt_failure_propagates(self):
        """BT getTemperature 예외는 삼키지 않고 read()로 전파돼야 한다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(exc=RuntimeError("EPHIDGET_NOTATTACHED"))
        adapter._sensor_et = _sensor(210.0)

        with pytest.raises(RuntimeError, match="EPHIDGET_NOTATTACHED"):
            await adapter.read()

    async def test_et_failure_soft_fails(self):
        """ET만 실패하면 BT는 정상값, ET는 -1.0으로 반환한다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(185.44)
        adapter._sensor_et = _sensor(exc=RuntimeError("EPHIDGET_NOTATTACHED"))

        reading = await adapter.read()
        assert reading.bt == 185.4
        assert reading.et == -1.0

    async def test_missing_et_channel_returns_sentinel(self):
        adapter = PhidgetAdapter(channel_et=None)
        adapter._sensor_bt = _sensor(180.0)
        adapter._sensor_et = None

        reading = await adapter.read()
        assert reading.bt == 180.0
        assert reading.et == -1.0

    async def test_heater_channel_is_none_not_zero(self):
        """열전대만 있는 장치는 화력 채널이 없다 — 0은 '측정 0'과 구분되지 않는다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(180.0)
        adapter._sensor_et = _sensor(210.0)

        reading = await adapter.read()
        assert reading.heater is None

    async def test_read_without_connect_raises(self):
        adapter = PhidgetAdapter()
        with pytest.raises(ConnectionError):
            await adapter.read()


class TestConnectCancellation:
    """openWaitForAttachment(5s)는 중단 불가 — 뒤늦은 완료를 사후 차단해야 한다 (#208)."""

    async def test_late_attach_after_session_bump_is_discarded(self):
        adapter = PhidgetAdapter(channel_et=None)
        sensor = mock.MagicMock()

        def bump_session(_timeout):
            adapter._session += 1  # attach 대기 중 disconnect 상당

        sensor.openWaitForAttachment.side_effect = bump_session

        with mock.patch.object(PhidgetAdapter, "_make_sensor", return_value=sensor):
            with pytest.raises(ConnectionError, match="취소"):
                await adapter.connect()

        assert adapter._sensor_bt is None, "취소된 시도가 센서를 바인딩하면 안 된다"
        assert adapter.connected is False
        assert sensor.close.call_count == 1, "열린 핸들은 닫아야 한다 (누수 방지)"

    async def test_normal_connect_binds_sensors(self):
        adapter = PhidgetAdapter(channel_et=None)
        sensor = mock.MagicMock()

        with mock.patch.object(PhidgetAdapter, "_make_sensor", return_value=sensor):
            await adapter.connect()

        assert adapter._sensor_bt is sensor
        assert adapter.connected is True

    async def test_disconnect_bumps_session(self):
        adapter = PhidgetAdapter()
        before = adapter._session
        await adapter.disconnect()
        assert adapter._session == before + 1

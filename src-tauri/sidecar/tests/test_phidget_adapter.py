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

    async def test_read_without_connect_raises(self):
        adapter = PhidgetAdapter()
        with pytest.raises(ConnectionError):
            await adapter.read()

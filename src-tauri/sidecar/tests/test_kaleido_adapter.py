"""KaleidoAdapter: connect timeout cleanup + non-blocking read/disconnect."""
from unittest.mock import MagicMock, patch

import pytest

from adapters.base import Reading


def _make_adapter(**kwargs):
    with patch.dict("sys.modules", {"extern.kaleido": MagicMock()}):
        # Re-import path: KaleidoAdapter imports KaleidoPort inside __init__
        from adapters.kaleido import KaleidoAdapter

        adapter = KaleidoAdapter(mode="TCP", host="127.0.0.1", **kwargs)
        return adapter


class TestKaleidoConnectTimeout:
    async def test_timeout_calls_driver_stop(self):
        adapter = _make_adapter()
        driver = MagicMock()
        driver.get_state.return_value = None  # never completes handshake
        adapter._driver = driver
        adapter._driver.start = MagicMock()
        adapter._driver.stop = MagicMock()

        with patch("adapters.kaleido._CONNECT_TIMEOUT", 0.15), patch(
            "adapters.kaleido._CONNECT_POLL", 0.05
        ):
            with pytest.raises(ConnectionError, match="타임아웃"):
                await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_called_once()
        assert adapter.connected is False

    async def test_success_does_not_stop(self):
        adapter = _make_adapter()
        driver = MagicMock()
        # sid + TU both set → handshake complete
        driver.get_state.side_effect = lambda key: {
            "sid": 1,
            "TU": "C",
        }.get(key)
        adapter._driver = driver
        adapter._driver.start = MagicMock()
        adapter._driver.stop = MagicMock()

        await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_not_called()
        assert adapter.connected is True


class TestKaleidoReadDisconnect:
    async def test_read_returns_driver_values(self):
        adapter = _make_adapter()
        driver = MagicMock()
        driver.getBTET.return_value = (180.5, 200.0, 1)
        driver.get_state.side_effect = lambda key: {
            "HP": 50,
            "FC": 30,
            "RC": 10,
        }.get(key, 0)
        adapter._driver = driver

        reading = await adapter.read()

        assert isinstance(reading, Reading)
        assert reading.bt == 180.5
        assert reading.et == 200.0
        assert reading.heater == 50.0
        assert reading.fan == 30.0
        assert reading.drum == 10.0
        driver.getBTET.assert_called_once()

    async def test_disconnect_calls_stop(self):
        adapter = _make_adapter()
        driver = MagicMock()
        adapter._driver = driver
        adapter._connected = True

        await adapter.disconnect()

        driver.stop.assert_called_once()
        assert adapter.connected is False

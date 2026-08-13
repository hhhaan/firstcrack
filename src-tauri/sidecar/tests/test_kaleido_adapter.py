"""KaleidoAdapter: real adapter, mocked driver I/O only.

허위 연결 성공(구 세션 sid/TU)이 불가능하고, connect마다 새 드라이버 +
명시 teardown이 일어나는지를 고정한다.
"""
import asyncio
from unittest.mock import MagicMock, patch

import pytest

from adapters.base import Reading
from adapters.kaleido import KaleidoAdapter


def _make_adapter(**kwargs) -> KaleidoAdapter:
    return KaleidoAdapter(mode="TCP", host="127.0.0.1", **kwargs)


def _fake_driver(*, handshake: bool = False) -> MagicMock:
    driver = MagicMock()
    if handshake:
        driver.get_state.side_effect = lambda key: {"sid": 1, "TU": "C"}.get(key)
    else:
        driver.get_state.return_value = None
    loop_thread = MagicMock()
    loop_thread.stop.return_value = True
    driver._asyncLoopThread = loop_thread
    return driver


class TestKaleidoConnectTimeout:
    async def test_timeout_calls_driver_and_loop_stop(self):
        adapter = _make_adapter()
        driver = _fake_driver(handshake=False)
        adapter._new_driver = lambda: driver

        with patch("adapters.kaleido._CONNECT_TIMEOUT", 0.15), patch(
            "adapters.kaleido._CONNECT_POLL", 0.05
        ):
            with pytest.raises(ConnectionError, match="타임아웃"):
                await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_called_once()
        driver._asyncLoopThread.stop.assert_called_once()
        assert adapter.connected is False
        assert adapter._driver is None

    async def test_success_does_not_stop(self):
        adapter = _make_adapter()
        driver = _fake_driver(handshake=True)
        adapter._new_driver = lambda: driver

        await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_not_called()
        driver._asyncLoopThread.stop.assert_not_called()
        assert adapter.connected is True
        assert adapter._driver is driver


class TestKaleidoFreshDriverAndTeardown:
    async def test_each_connect_creates_fresh_driver(self):
        adapter = _make_adapter()
        first = _fake_driver(handshake=True)
        second = _fake_driver(handshake=True)
        factory = MagicMock(side_effect=[first, second])
        adapter._new_driver = factory

        await adapter.connect()
        assert adapter._driver is first

        await adapter.connect()

        assert factory.call_count == 2
        assert first is not second
        assert adapter._driver is second
        first.stop.assert_called_once()
        first._asyncLoopThread.stop.assert_called_once()
        second.stop.assert_not_called()
        assert adapter.connected is True

    async def test_stale_sid_tu_cannot_fake_success(self):
        """구 세션이 sid/TU를 들고 있어도 새 드라이버 핸드셰이크만 본다."""
        adapter = _make_adapter()
        stale = _fake_driver(handshake=True)
        fresh = _fake_driver(handshake=False)
        adapter._driver = stale
        adapter._connected = True
        adapter._new_driver = lambda: fresh

        with patch("adapters.kaleido._CONNECT_TIMEOUT", 0.15), patch(
            "adapters.kaleido._CONNECT_POLL", 0.05
        ):
            with pytest.raises(ConnectionError, match="타임아웃"):
                await adapter.connect()

        assert adapter.connected is False
        assert adapter._driver is None
        stale.stop.assert_called_once()
        fresh.start.assert_called_once()
        fresh.stop.assert_called_once()
        fresh._asyncLoopThread.stop.assert_called_once()

    async def test_reconnect_tears_down_previous_session(self):
        adapter = _make_adapter()
        first = _fake_driver(handshake=True)
        second = _fake_driver(handshake=False)
        adapter._new_driver = MagicMock(side_effect=[first, second])

        await adapter.connect()
        with patch("adapters.kaleido._CONNECT_TIMEOUT", 0.15), patch(
            "adapters.kaleido._CONNECT_POLL", 0.05
        ):
            with pytest.raises(ConnectionError, match="타임아웃"):
                await adapter.connect()

        first.stop.assert_called_once()
        first._asyncLoopThread.stop.assert_called_once()
        second.stop.assert_called_once()
        assert adapter.connected is False

    async def test_cancel_during_handshake_tears_down(self):
        adapter = _make_adapter()
        driver = _fake_driver(handshake=False)
        adapter._new_driver = lambda: driver

        with patch("adapters.kaleido._CONNECT_TIMEOUT", 2.0), patch(
            "adapters.kaleido._CONNECT_POLL", 0.05
        ):
            task = asyncio.create_task(adapter.connect())
            await asyncio.sleep(0.08)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        driver.stop.assert_called_once()
        driver._asyncLoopThread.stop.assert_called_once()
        assert adapter.connected is False
        assert adapter._driver is None


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
        driver = _fake_driver(handshake=True)
        adapter._driver = driver
        adapter._connected = True

        await adapter.disconnect()

        driver.stop.assert_called_once()
        driver._asyncLoopThread.stop.assert_called_once()
        assert adapter.connected is False
        assert adapter._driver is None

    async def test_read_after_disconnect_raises(self):
        adapter = _make_adapter()
        driver = _fake_driver(handshake=True)
        adapter._driver = driver
        adapter._connected = True

        await adapter.disconnect()

        with pytest.raises(ConnectionError):
            await adapter.read()

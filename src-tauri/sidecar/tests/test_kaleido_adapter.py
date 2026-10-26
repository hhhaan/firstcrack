"""KaleidoAdapter: 세션 격리, 종료, 읽기."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from adapters.base import Reading
from adapters.kaleido import KaleidoAdapter

_READY = {"sid": 1, "TU": "C"}


def _make_link(state: dict | None = None) -> AsyncMock:
    link = AsyncMock()
    link.snapshot = MagicMock(return_value=dict(state or {}))
    link.read_temperatures.return_value = (0.0, 0.0)
    return link


def _make_adapter(links: list[AsyncMock] | None = None, **kwargs) -> KaleidoAdapter:
    adapter = KaleidoAdapter(mode="TCP", host="127.0.0.1", **kwargs)
    queue = list(links or [])
    adapter._created: list[AsyncMock] = []

    def factory() -> AsyncMock:
        link = queue.pop(0) if queue else _make_link()
        adapter._created.append(link)
        return link

    adapter._new_link = factory  # type: ignore[method-assign]
    return adapter


class TestKaleidoConnectTimeout:
    async def test_timeout_shuts_down_link(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        link = _make_link()
        adapter = _make_adapter([link])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        link.start_session.assert_awaited_once()
        link.shutdown.assert_awaited_once()
        assert adapter._link is None
        assert adapter.connected is False

    async def test_shutdown_error_still_clears_link(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        link = _make_link()
        link.shutdown.side_effect = RuntimeError("close failed")
        adapter = _make_adapter([link])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        assert adapter._link is None

    async def test_slow_shutdown_does_not_hold_the_timeout(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        monkeypatch.setattr("adapters.kaleido._TEARDOWN_TIMEOUT", 0.05)

        async def hang() -> None:
            await asyncio.sleep(5)

        link = _make_link()
        link.shutdown = hang
        adapter = _make_adapter([link])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        assert adapter._link is None

    async def test_success_does_not_shut_down(self):
        link = _make_link(_READY)
        adapter = _make_adapter([link])

        await adapter.connect()

        link.start_session.assert_awaited_once()
        link.shutdown.assert_not_awaited()
        assert adapter._link is link
        assert adapter.connected is True

    async def test_cancel_during_handshake_shuts_down(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.01)
        link = _make_link()
        adapter = _make_adapter([link])

        task = asyncio.create_task(adapter.connect())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        link.shutdown.assert_awaited_once()
        assert adapter._link is None
        assert adapter.connected is False


class TestKaleidoGenerationIsolation:
    async def test_each_connect_creates_fresh_link(self):
        first = _make_link(_READY)
        second = _make_link(_READY)
        adapter = _make_adapter([first, second])

        await adapter.connect()
        await adapter.connect()

        assert adapter._created == [first, second]
        assert first is not second
        assert adapter._link is second

    async def test_reconnect_shuts_down_previous_session(self):
        first = _make_link(_READY)
        second = _make_link(_READY)
        adapter = _make_adapter([first, second])

        await adapter.connect()
        await adapter.connect()

        first.shutdown.assert_awaited_once()
        second.shutdown.assert_not_awaited()

    async def test_stale_link_state_cannot_fake_success(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        stale = _make_link(_READY)
        fresh = _make_link()
        adapter = _make_adapter([stale, fresh])

        await adapter.connect()
        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        assert adapter.connected is False
        assert adapter._link is None

    async def test_handshake_polls_local_link_not_self(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.3)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.01)
        link = _make_link()
        adapter = _make_adapter([link])

        task = asyncio.create_task(adapter.connect())
        await asyncio.sleep(0.05)
        await adapter.disconnect()
        with pytest.raises(ConnectionError, match="타임아웃"):
            await task

        link.shutdown.assert_awaited_once()

    async def test_connect_entry_clears_connected_flag(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        adapter = _make_adapter([_make_link(_READY), _make_link()])

        await adapter.connect()
        assert adapter.connected is True
        with pytest.raises(ConnectionError):
            await adapter.connect()
        assert adapter.connected is False


class TestKaleidoReadDisconnect:
    async def test_read_returns_link_values(self):
        link = _make_link({"HP": 50, "FC": 30, "RC": 10, **_READY})
        link.read_temperatures.return_value = (180.5, 200.0)
        adapter = _make_adapter([link])

        await adapter.connect()
        reading = await adapter.read()

        assert isinstance(reading, Reading)
        assert reading.bt == 180.5
        assert reading.et == 200.0
        assert reading.heater == 50.0
        assert reading.fan == 30.0
        assert reading.drum == 10.0
        link.read_temperatures.assert_awaited_once()

    async def test_missing_hp_stays_unset_not_zero(self):
        link = _make_link({"FC": 30, "RC": 10, **_READY})
        link.read_temperatures.return_value = (180.5, 200.0)
        adapter = _make_adapter([link])

        await adapter.connect()
        reading = await adapter.read()

        assert reading.heater == -1.0
        assert reading.fan == 30.0

    async def test_reported_zero_hp_stays_zero(self):
        link = _make_link({"HP": 0, "FC": 30, "RC": 10, **_READY})
        link.read_temperatures.return_value = (180.5, 200.0)
        adapter = _make_adapter([link])

        await adapter.connect()
        assert (await adapter.read()).heater == 0.0

    async def test_missing_fan_and_drum_stay_unset(self):
        link = _make_link(_READY)
        adapter = _make_adapter([link])

        await adapter.connect()
        reading = await adapter.read()

        assert reading.fan == -1.0
        assert reading.drum == -1.0

    async def test_disconnect_shuts_down_once(self):
        link = _make_link(_READY)
        adapter = _make_adapter([link])
        await adapter.connect()

        await adapter.disconnect()

        link.shutdown.assert_awaited_once()
        assert adapter.connected is False
        assert adapter._link is None

    async def test_double_disconnect_is_noop(self):
        link = _make_link(_READY)
        adapter = _make_adapter([link])
        await adapter.connect()

        await adapter.disconnect()
        await adapter.disconnect()

        link.shutdown.assert_awaited_once()

    async def test_read_after_disconnect_raises(self):
        link = _make_link(_READY)
        adapter = _make_adapter([link])
        await adapter.connect()
        await adapter.disconnect()

        with pytest.raises(ConnectionError):
            await adapter.read()

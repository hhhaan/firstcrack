"""KaleidoAdapter: 세대 격리(connect마다 새 driver) + 결정적 teardown + non-blocking read."""
import asyncio
from unittest.mock import MagicMock

import pytest

from adapters.base import Reading
from adapters.kaleido import _TEARDOWN_TIMEOUT, KaleidoAdapter


def _make_driver(state: dict | None = None, *, loop_thread: MagicMock | None = None) -> MagicMock:
    """핸드셰이크 상태를 흉내내는 KaleidoPort 스텁."""
    driver = MagicMock()
    driver.get_state.side_effect = lambda key: (state or {}).get(key)
    driver.getBTET.return_value = (0.0, 0.0, 0)
    if loop_thread is None:
        loop_thread = MagicMock()
        loop_thread.stop.return_value = True
    driver._asyncLoopThread = loop_thread
    return driver


def _make_adapter(drivers: list[MagicMock] | None = None, **kwargs) -> KaleidoAdapter:
    """드라이버 팩토리 시임을 주입한 어댑터.

    `drivers`를 주면 connect 호출 순서대로 하나씩 내준다.
    """
    adapter = KaleidoAdapter(mode="TCP", host="127.0.0.1", **kwargs)
    queue = list(drivers or [])
    adapter._created: list[MagicMock] = []

    def factory() -> MagicMock:
        driver = queue.pop(0) if queue else _make_driver()
        adapter._created.append(driver)
        return driver

    adapter._new_driver = factory
    return adapter


_HANDSHAKE_OK = {"sid": 1, "TU": "C"}


class TestKaleidoConnectTimeout:
    async def test_timeout_tears_down_driver_and_loop_thread(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        loop_thread = MagicMock()
        loop_thread.stop.return_value = True
        driver = _make_driver(loop_thread=loop_thread)  # 핸드셰이크 영영 미완료
        adapter = _make_adapter([driver])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_called_once()
        loop_thread.stop.assert_called_once_with(_TEARDOWN_TIMEOUT)
        assert adapter._driver is None
        assert adapter.connected is False

    async def test_teardown_without_loop_thread_is_noop(self, monkeypatch):
        """start()가 예외를 삼켜 _asyncLoopThread가 None이어도 정상 종료."""
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        driver = _make_driver()
        driver._asyncLoopThread = None
        adapter = _make_adapter([driver])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        driver.stop.assert_called_once()
        assert adapter._driver is None

    async def test_loop_thread_join_timeout_only_warns(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        loop_thread = MagicMock()
        loop_thread.stop.return_value = False  # 시한 내 종료 실패
        driver = _make_driver(loop_thread=loop_thread)
        adapter = _make_adapter([driver])

        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()

        assert adapter._driver is None

    async def test_success_does_not_stop(self):
        driver = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([driver])

        await adapter.connect()

        driver.start.assert_called_once()
        driver.stop.assert_not_called()
        assert adapter._driver is driver
        assert adapter.connected is True

    async def test_cancel_during_handshake_tears_down(self, monkeypatch):
        """#208 회귀: 핸드셰이크 중 취소돼도 소켓/루프 스레드를 남기지 않는다."""
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.01)
        loop_thread = MagicMock()
        loop_thread.stop.return_value = True
        driver = _make_driver(loop_thread=loop_thread)  # 영영 미완료
        adapter = _make_adapter([driver])

        task = asyncio.create_task(adapter.connect())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        driver.stop.assert_called_once()
        loop_thread.stop.assert_called_once_with(_TEARDOWN_TIMEOUT)
        assert adapter._driver is None
        assert adapter.connected is False


class TestKaleidoGenerationIsolation:
    async def test_each_connect_creates_fresh_driver(self):
        first = _make_driver(_HANDSHAKE_OK)
        second = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([first, second])

        await adapter.connect()
        await adapter.connect()

        assert adapter._created == [first, second]
        assert first is not second
        assert adapter._driver is second

    async def test_reconnect_tears_down_previous_session(self):
        first = _make_driver(_HANDSHAKE_OK)
        second = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([first, second])

        await adapter.connect()
        await adapter.connect()

        first.stop.assert_called_once()
        first._asyncLoopThread.stop.assert_called_once_with(_TEARDOWN_TIMEOUT)
        second.stop.assert_not_called()

    async def test_stale_driver_state_cannot_fake_success(self, monkeypatch):
        """허위 연결 성공 차단: 구 세션이 sid/TU를 들고 살아 있어도

        새 세션 핸드셰이크가 미완료면 connect()는 실패해야 한다.
        """
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        stale = _make_driver(_HANDSHAKE_OK)  # 구 세션: 상태 채워져 있음
        fresh = _make_driver()  # 새 세션: sid/TU 모두 None
        adapter = _make_adapter([stale, fresh])

        await adapter.connect()  # 1회차 성공 (stale)
        with pytest.raises(ConnectionError, match="타임아웃"):
            await adapter.connect()  # 2회차는 fresh를 봐야 하므로 실패

        assert adapter.connected is False
        assert adapter._driver is None

    async def test_handshake_polls_local_driver_not_self(self, monkeypatch):
        """핸드셰이크 폴링이 self._driver를 보면 동시 disconnect에 AttributeError로 깨진다."""
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.3)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.01)
        driver = _make_driver()  # 핸드셰이크 미완료
        adapter = _make_adapter([driver])

        task = asyncio.create_task(adapter.connect())
        await asyncio.sleep(0.05)
        await adapter.disconnect()  # 폴링 도중 self._driver = None
        with pytest.raises(ConnectionError, match="타임아웃"):
            await task

        driver.stop.assert_called_once()  # 재진입 방어로 중복 stop 없음

    async def test_connect_entry_clears_connected_flag(self, monkeypatch):
        monkeypatch.setattr("adapters.kaleido._CONNECT_TIMEOUT", 0.15)
        monkeypatch.setattr("adapters.kaleido._CONNECT_POLL", 0.05)
        adapter = _make_adapter([_make_driver(_HANDSHAKE_OK), _make_driver()])

        await adapter.connect()
        assert adapter.connected is True
        with pytest.raises(ConnectionError):
            await adapter.connect()
        assert adapter.connected is False


class TestKaleidoReadDisconnect:
    async def test_read_returns_driver_values(self):
        driver = _make_driver({"HP": 50, "FC": 30, "RC": 10, **_HANDSHAKE_OK})
        driver.getBTET.return_value = (180.5, 200.0, 1)
        adapter = _make_adapter([driver])

        await adapter.connect()
        reading = await adapter.read()

        assert isinstance(reading, Reading)
        assert reading.bt == 180.5
        assert reading.et == 200.0
        assert reading.heater == 50.0
        assert reading.fan == 30.0
        assert reading.drum == 10.0
        driver.getBTET.assert_called_once()

    async def test_disconnect_calls_stop(self):
        driver = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([driver])
        await adapter.connect()

        await adapter.disconnect()

        driver.stop.assert_called_once()
        driver._asyncLoopThread.stop.assert_called_once_with(_TEARDOWN_TIMEOUT)
        assert adapter.connected is False
        assert adapter._driver is None

    async def test_double_disconnect_is_noop(self):
        driver = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([driver])
        await adapter.connect()

        await adapter.disconnect()
        await adapter.disconnect()

        driver.stop.assert_called_once()

    async def test_read_after_disconnect_raises(self):
        driver = _make_driver(_HANDSHAKE_OK)
        adapter = _make_adapter([driver])
        await adapter.connect()
        await adapter.disconnect()

        with pytest.raises(ConnectionError):
            await adapter.read()

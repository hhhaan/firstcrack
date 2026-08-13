"""AsyncLoopThread.stop() is an explicit teardown contract (stdlib only)."""
import threading

from extern.async_comm import AsyncLoopThread


class TestAsyncLoopThreadStop:
    def test_stop_joins_thread(self):
        t = AsyncLoopThread()
        thread = t._AsyncLoopThread__thread
        assert thread.is_alive()

        assert t.stop(timeout=2.0) is True

        assert not thread.is_alive()
        assert t.loop.is_closed()

    def test_stop_idempotent(self):
        t = AsyncLoopThread()

        assert t.stop(timeout=2.0) is True
        assert t.stop(timeout=2.0) is True
        assert t.loop.is_closed()

    def test_stop_returns_false_when_hung(self):
        t = AsyncLoopThread()
        started = threading.Event()
        release = threading.Event()

        def block_loop() -> None:
            started.set()
            release.wait()

        t.loop.call_soon_threadsafe(block_loop)
        assert started.wait(timeout=2.0)

        assert t.stop(timeout=0.15) is False
        assert t._AsyncLoopThread__thread.is_alive()

        release.set()
        assert t.stop(timeout=2.0) is True
        assert not t._AsyncLoopThread__thread.is_alive()

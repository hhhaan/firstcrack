"""AsyncLoopThread.stop(): 명시적 루프 종료 + 스레드 join 계약 (stdlib만 사용)."""
import time

from extern.async_comm import AsyncLoopThread


def test_stop_joins_thread():
    lt = AsyncLoopThread()
    assert lt.stop(2.0) is True
    assert lt.loop.is_closed()


def test_stop_is_idempotent():
    lt = AsyncLoopThread()
    assert lt.stop(2.0) is True
    # 이미 닫힌 루프 + 죽은 스레드 → 가드 없이도 True
    assert lt.stop(2.0) is True


def test_stop_returns_false_when_loop_is_blocked():
    lt = AsyncLoopThread()
    # 루프 스레드를 붙잡아 두면 call_soon_threadsafe(stop)이 시한 내 처리되지 않는다.
    lt.loop.call_soon_threadsafe(lambda: time.sleep(0.6))
    time.sleep(0.05)
    assert lt.stop(0.05) is False
    # 정리: 블로킹이 끝난 뒤에는 정상 종료
    assert lt.stop(2.0) is True

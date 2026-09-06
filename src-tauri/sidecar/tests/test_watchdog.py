"""Tests for parent-PID watchdog utilities."""
import asyncio
import os
import sys
import unittest.mock as mock

import pytest


# ---------------------------------------------------------------------------
# _pid_alive
# ---------------------------------------------------------------------------

class TestPidAlive:
    def test_own_pid_is_alive(self):
        from main import _pid_alive
        assert _pid_alive(os.getpid()) is True

    def test_nonexistent_pid_is_dead(self):
        from main import _pid_alive
        assert _pid_alive(999999999) is False

    def test_returns_bool(self):
        from main import _pid_alive
        result = _pid_alive(os.getpid())
        assert isinstance(result, bool)

    @pytest.mark.skipif(sys.platform == "win32", reason="POSIX os.kill 경로")
    def test_permission_error_means_alive(self):
        """EPERM은 '권한 없음'이지 '죽음'이 아니다 — True여야 사이드카가 자살하지 않는다 (H9)."""
        from main import _pid_alive
        with mock.patch("main.os.kill", side_effect=PermissionError(1, "Operation not permitted")):
            assert _pid_alive(os.getpid()) is True

    @pytest.mark.skipif(sys.platform == "win32", reason="POSIX os.kill 경로")
    def test_process_lookup_error_means_dead(self):
        from main import _pid_alive
        with mock.patch("main.os.kill", side_effect=ProcessLookupError(3, "No such process")):
            assert _pid_alive(os.getpid()) is False


# ---------------------------------------------------------------------------
# parent_watchdog
# ---------------------------------------------------------------------------

class TestWatchdogTaskReference:
    async def test_task_stored_on_app(self, monkeypatch):
        """create_task 반환값을 app에 보관해야 GC가 워치독을 수거하지 않는다 (H9)."""
        from aiohttp.test_utils import TestClient, TestServer
        from main import create_app

        monkeypatch.setenv("SIDECAR_PARENT_PID", str(os.getpid()))
        app = create_app()
        app["manager"] = mock.AsyncMock()
        async with TestClient(TestServer(app)):
            task = app.get("watchdog_task")
            assert task is not None
            assert not task.done()
        # on_cleanup에서 취소돼야 teardown 경고가 남지 않는다
        assert app["watchdog_task"].cancelled() or app["watchdog_task"].done()


class TestParentWatchdog:
    async def test_watchdog_calls_exit_on_dead_pid(self):
        """존재하지 않는 PID를 넘기면 disconnect 후 os._exit(0)을 호출해야 한다."""
        from main import parent_watchdog

        exit_called_with = []
        manager = mock.AsyncMock()

        class _Exited(Exception):
            pass

        def fake_exit(code):
            # 실제 _exit처럼 루프를 끝내야 한다 — 아니면 짧은 interval에서 계속 돈다
            exit_called_with.append(code)
            raise _Exited(code)

        with mock.patch("main.os._exit", side_effect=fake_exit):
            with mock.patch("main._pid_alive", return_value=False):
                task = asyncio.create_task(parent_watchdog(999999999, manager, interval=0.05))
                try:
                    await asyncio.wait_for(task, timeout=2.0)
                except (asyncio.TimeoutError, asyncio.CancelledError, _Exited):
                    pass

        manager.disconnect.assert_awaited_once()
        assert exit_called_with == [0], f"os._exit(0) 미호출: {exit_called_with}"

    async def test_watchdog_continues_if_parent_alive(self):
        """부모가 살아 있으면 워치독이 계속 실행 중이어야 한다."""
        from main import parent_watchdog

        call_count = 0
        manager = mock.AsyncMock()

        def fake_pid_alive(pid):
            nonlocal call_count
            call_count += 1
            return True

        with mock.patch("main._pid_alive", side_effect=fake_pid_alive):
            task = asyncio.create_task(parent_watchdog(os.getpid(), manager, interval=0.05))
            await asyncio.sleep(0.3)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert call_count >= 2, f"기대: >=2 호출, 실제: {call_count}"
        manager.disconnect.assert_not_awaited()


# ---------------------------------------------------------------------------
# /shutdown endpoint
# ---------------------------------------------------------------------------

class TestShutdownEndpoint:
    async def test_shutdown_returns_200(self, monkeypatch):
        from aiohttp.test_utils import TestClient, TestServer
        from main import create_app

        monkeypatch.delenv("SIDECAR_TOKEN", raising=False)
        app = create_app()
        app["manager"] = mock.AsyncMock()
        async with TestClient(TestServer(app)) as client:
            with mock.patch("main.os._exit"):
                resp = await client.post("/shutdown")
                assert resp.status == 200
        app["manager"].disconnect.assert_awaited()


# ---------------------------------------------------------------------------
# _exit_if_parent_dead
# ---------------------------------------------------------------------------

class TestExitIfParentDead:
    def test_absent_parent_pid_allows_direct_dev_run(self, monkeypatch):
        from main import _exit_if_parent_dead

        monkeypatch.delenv("SIDECAR_PARENT_PID", raising=False)
        _exit_if_parent_dead()

    def test_live_parent_allows_bind(self, monkeypatch):
        from main import _exit_if_parent_dead

        monkeypatch.setenv("SIDECAR_PARENT_PID", str(os.getpid()))
        with mock.patch("main._pid_alive", return_value=True):
            _exit_if_parent_dead()

    @pytest.mark.parametrize("parent_pid", ["invalid", "999999999"])
    def test_invalid_or_dead_parent_exits_before_bind(self, monkeypatch, parent_pid):
        from main import _exit_if_parent_dead

        monkeypatch.setenv("SIDECAR_PARENT_PID", parent_pid)
        with mock.patch("main._pid_alive", return_value=False):
            with pytest.raises(SystemExit) as exc:
                _exit_if_parent_dead()
        assert exc.value.code == 0

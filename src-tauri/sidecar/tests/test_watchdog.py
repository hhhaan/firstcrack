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


# ---------------------------------------------------------------------------
# parent_watchdog
# ---------------------------------------------------------------------------

class TestParentWatchdog:
    async def test_watchdog_calls_exit_on_dead_pid(self):
        """존재하지 않는 PID를 넘기면 watchdog이 os._exit(0)을 호출해야 한다."""
        from main import parent_watchdog

        exit_called_with = []

        with mock.patch("main.os._exit", side_effect=lambda code: exit_called_with.append(code)):
            with mock.patch("main._pid_alive", return_value=False):
                task = asyncio.create_task(parent_watchdog(999999999))
                try:
                    await asyncio.wait_for(task, timeout=2.0)
                except (asyncio.TimeoutError, asyncio.CancelledError, SystemExit):
                    pass

        assert exit_called_with == [0], f"os._exit(0) 미호출: {exit_called_with}"

    async def test_watchdog_continues_if_parent_alive(self):
        """부모가 살아 있으면 워치독이 계속 실행 중이어야 한다."""
        from main import parent_watchdog

        call_count = 0

        def fake_pid_alive(pid):
            nonlocal call_count
            call_count += 1
            return True

        with mock.patch("main._pid_alive", side_effect=fake_pid_alive):
            task = asyncio.create_task(parent_watchdog(os.getpid()))
            await asyncio.sleep(2.5)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert call_count >= 2, f"기대: >=2 호출, 실제: {call_count}"


# ---------------------------------------------------------------------------
# /shutdown endpoint
# ---------------------------------------------------------------------------

class TestShutdownEndpoint:
    async def test_shutdown_returns_200(self):
        from aiohttp.test_utils import TestClient, TestServer
        from main import create_app

        app = create_app()
        async with TestClient(TestServer(app)) as client:
            with mock.patch("main.os._exit"):
                resp = await client.post("/shutdown")
                assert resp.status == 200

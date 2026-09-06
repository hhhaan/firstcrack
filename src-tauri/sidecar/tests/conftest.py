"""Shared fixtures for sidecar tests."""
import asyncio
import os
import time

# main.py가 import 시점에 Sentry를 init한다 — 테스트에서 production DSN으로
# 이벤트가 전송되지 않게 어떤 테스트 모듈보다 먼저 끈다 (#269).
os.environ.setdefault("SIDECAR_DISABLE_SENTRY", "1")
from collections import deque
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from adapters.base import MachineAdapter, Reading
from manager import RoasterManager


def make_reading(bt: float = 150.0, et: float = 200.0, ts: float | None = None) -> Reading:
    return Reading(
        bt=bt,
        et=et,
        heater=50.0,
        fan=60.0,
        drum=70.0,
        timestamp=ts if ts is not None else time.monotonic(),
    )


class FakeAdapter(MachineAdapter):
    """Controllable fake adapter for unit tests."""

    writable = True

    def __init__(
        self,
        readings: list[Reading] | None = None,
        connect_exc: Exception | None = None,
        connect_gate: asyncio.Event | None = None,
    ):
        self._readings = list(readings or [])
        self._read_index = 0
        self._connect_exc = connect_exc
        # connect_gate가 주어지면 set() 될 때까지 핸드셰이크에 머문다 —
        # "연결 시도 중"을 결정적으로 재현하기 위한 시임 (기본 None = 기존 동작).
        self._connect_gate = connect_gate
        self.connect_started = asyncio.Event()
        self.connect_cancelled = False
        self.connected = False
        self.disconnected = False
        self.connect_call_count = 0
        self.control_calls: list[dict] = []

    async def connect(self) -> None:
        self.connect_call_count += 1
        self.connect_started.set()
        if self._connect_gate is not None:
            try:
                await self._connect_gate.wait()
            except asyncio.CancelledError:
                self.connect_cancelled = True
                raise
        if self._connect_exc is not None:
            raise self._connect_exc
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnected = True
        self.connected = False

    async def read(self) -> Reading:
        if self._read_index < len(self._readings):
            r = self._readings[self._read_index]
            self._read_index += 1
            return r
        raise RuntimeError("no more readings")

    async def control(self, heater=None, fan=None, drum=None) -> None:
        self.control_calls.append({"heater": heater, "fan": fan, "drum": drum})


@pytest.fixture(autouse=True)
def reset_trace():
    """Reset global TRACE singleton before/after each test to prevent state leakage."""
    from protocol_trace import TRACE
    TRACE.enabled = False
    TRACE.clear()
    yield
    TRACE.enabled = False
    TRACE.clear()


@pytest.fixture
async def manager():
    m = RoasterManager()
    yield m
    # Cancel any pending reconnect/connect task to avoid asyncio teardown warnings
    for task in (m._reconnect_task, m._connect_task):
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

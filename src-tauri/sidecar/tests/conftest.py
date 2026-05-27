"""Shared fixtures for sidecar tests."""
import asyncio
import time
from collections import deque
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from adapters.base import Reading
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


class FakeAdapter:
    """Controllable fake adapter for unit tests."""

    def __init__(self, readings: list[Reading] | None = None, connect_exc: Exception | None = None):
        self._readings = list(readings or [])
        self._read_index = 0
        self._connect_exc = connect_exc
        self.connected = False
        self.disconnected = False
        self.connect_call_count = 0
        self.control_calls: list[dict] = []

    async def connect(self) -> None:
        self.connect_call_count += 1
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


@pytest.fixture
async def manager():
    m = RoasterManager()
    yield m
    # Cancel any pending reconnect task to avoid asyncio teardown warnings
    if m._reconnect_task is not None and not m._reconnect_task.done():
        m._reconnect_task.cancel()
        try:
            await m._reconnect_task
        except (asyncio.CancelledError, Exception):
            pass

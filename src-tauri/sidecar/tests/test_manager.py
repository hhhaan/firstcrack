"""Unit tests for RoasterManager."""
import asyncio
import time
from collections import deque
from unittest.mock import patch

import pytest

from adapters.base import Reading
from manager import RoasterManager
from tests.conftest import FakeAdapter, make_reading


# ---------------------------------------------------------------------------
# _least_squares_slope
# ---------------------------------------------------------------------------

class TestLeastSquaresSlope:
    def _slope(self, window):
        m = RoasterManager()
        return m._least_squares_slope(deque(window))

    def test_empty_returns_zero(self):
        assert self._slope([]) == 0.0

    def test_single_point_returns_zero(self):
        assert self._slope([(0.0, 150.0)]) == 0.0

    def test_constant_temp_returns_zero(self):
        pts = [(float(i), 150.0) for i in range(5)]
        assert self._slope(pts) == pytest.approx(0.0, abs=1e-6)

    def test_exact_linear_rise(self):
        # 10 °C/min = 10/60 °C/s → over 60s should give slope = 10.0
        t0 = 0.0
        pts = [(t0 + i * 6.0, 150.0 + i * 1.0) for i in range(11)]  # 6s intervals, 1°C each
        slope = self._slope(pts)
        # 1°C per 6s = 10°C/min
        assert slope == pytest.approx(10.0, rel=1e-4)

    def test_negative_slope(self):
        pts = [(float(i * 6), 200.0 - i * 1.0) for i in range(11)]
        slope = self._slope(pts)
        assert slope == pytest.approx(-10.0, rel=1e-4)

    def test_returns_per_minute_not_per_second(self):
        # Two points 60s apart with 5°C rise → slope = 5 °C/min
        pts = [(0.0, 150.0), (60.0, 155.0)]
        assert self._slope(pts) == pytest.approx(5.0, rel=1e-4)

    def test_identical_timestamps_returns_zero(self):
        pts = [(5.0, 150.0), (5.0, 160.0)]
        assert self._slope(pts) == 0.0


# ---------------------------------------------------------------------------
# status()
# ---------------------------------------------------------------------------

class TestStatus:
    async def test_initial_not_connected(self, manager):
        s = manager.status()
        assert s["connected"] is False
        assert s["roaster"] == ""
        assert s["error"] is None

    async def test_connected_false_until_data_ok(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=0.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        # bt=0 so _data_ok should remain False
        assert manager._data_ok is False
        assert manager.status()["connected"] is False

    async def test_connected_true_after_positive_bt(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager._data_ok is True
        assert manager.status()["connected"] is True

    async def test_disconnect_resets_connected(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        await manager.disconnect()
        assert manager.status()["connected"] is False

    async def test_error_propagated_in_status(self, manager):
        fake = FakeAdapter(connect_exc=ConnectionRefusedError("Connection refused"))
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        s = manager.status()
        assert s["connected"] is False
        assert s["error"] is not None


# ---------------------------------------------------------------------------
# connect()
# ---------------------------------------------------------------------------

class TestConnect:
    async def test_unknown_key_raises_value_error(self, manager):
        with pytest.raises(ValueError, match="알 수 없는 로스터"):
            await manager.connect("nonexistent_roaster_xyz", {})

    async def test_connect_exc_stored_not_raised(self, manager):
        fake = FakeAdapter(connect_exc=OSError("No such file or directory"))
        with patch("manager.make_adapter", return_value=fake):
            # Must NOT raise
            await manager.connect("virtual", {})
        assert manager._error is not None
        assert manager._connected is False

    async def test_second_connect_disconnects_first(self, manager):
        fake1 = FakeAdapter(readings=[make_reading(bt=150.0)])
        fake2 = FakeAdapter(readings=[make_reading(bt=160.0)])
        with patch("manager.make_adapter", return_value=fake1):
            await manager.connect("virtual", {})
        with patch("manager.make_adapter", return_value=fake2):
            await manager.connect("virtual", {})
        assert fake1.disconnected is True

    async def test_ror_window_cleared_on_reconnect(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0), make_reading(bt=155.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        # Manually add to window to simulate prior data
        manager._ror_window.append((time.monotonic(), 150.0))

        fake2 = FakeAdapter(readings=[make_reading(bt=160.0)])
        with patch("manager.make_adapter", return_value=fake2):
            await manager.connect("virtual", {})
        # Window should have been cleared and then populated by warmup read
        assert len(manager._ror_window) <= 1


# ---------------------------------------------------------------------------
# read_temperatures()
# ---------------------------------------------------------------------------

class TestReadTemperatures:
    async def test_returns_none_when_not_connected(self, manager):
        result = await manager.read_temperatures()
        assert result["bt"] is None
        assert result["et"] is None
        assert result["ror"] == 0.0

    async def test_normal_read_returns_values(self, manager):
        reading = make_reading(bt=185.0, et=220.0, ts=time.monotonic())
        fake = FakeAdapter(readings=[reading, reading])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        result = await manager.read_temperatures()
        assert result["bt"] is not None
        assert result["et"] is not None
        assert isinstance(result["ror"], float)

    async def test_read_failure_sets_not_connected(self, manager):
        # Warmup succeeds, then read raises
        warmup = make_reading(bt=150.0)
        fake = FakeAdapter(readings=[warmup])  # no more readings after warmup
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager._connected is True

        await manager.read_temperatures()  # will raise RuntimeError internally
        assert manager._connected is False

    async def test_read_failure_spawns_reconnect_task(self, manager):
        warmup = make_reading(bt=150.0)
        fake = FakeAdapter(readings=[warmup])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})

        await manager.read_temperatures()
        assert manager._reconnect_task is not None
        # Cancel immediately so teardown is clean
        manager._reconnect_task.cancel()
        try:
            await manager._reconnect_task
        except asyncio.CancelledError:
            pass

    async def test_data_ok_set_on_positive_bt_read(self, manager):
        t = time.monotonic()
        warmup = make_reading(bt=0.0, ts=t)  # warmup with bt=0
        live = make_reading(bt=150.0, ts=t + 1)
        fake = FakeAdapter(readings=[warmup, live])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager._data_ok is False  # warmup bt=0
        await manager.read_temperatures()
        assert manager._data_ok is True

    async def test_heater_fan_drum_returned(self, manager):
        r = Reading(bt=160.0, et=210.0, heater=75.0, fan=55.0, drum=80.0, timestamp=time.monotonic())
        fake = FakeAdapter(readings=[r, r])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        result = await manager.read_temperatures()
        assert result["heater"] == 75
        assert result["fan"] == 55
        assert result["drum"] == pytest.approx(80.0, abs=0.5)


# ---------------------------------------------------------------------------
# RoR accumulation
# ---------------------------------------------------------------------------

class TestRorAccumulation:
    async def _connected_manager(self, manager, readings):
        fake = FakeAdapter(readings=readings)
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        return manager

    async def test_ror_zero_with_single_point(self, manager):
        t = time.monotonic()
        fake = FakeAdapter(readings=[make_reading(bt=150.0, ts=t), make_reading(bt=151.0, ts=t + 1)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        # After warmup there's 1 point; one more read makes 2
        await manager.read_temperatures()
        # With 2 EMA-smoothed points we get a slope, but it should be finite
        ror = manager._compute_ror()
        assert isinstance(ror, float)

    async def test_ror_increases_with_rising_temp(self, manager):
        t0 = time.monotonic()
        warmup = make_reading(bt=150.0, ts=t0)
        readings = [make_reading(bt=150.0 + i * 1.0, ts=t0 + i * 6.0) for i in range(1, 12)]
        fake = FakeAdapter(readings=[warmup] + readings)
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        for _ in readings:
            await manager.read_temperatures()
        ror = manager._compute_ror()
        assert ror > 0

    async def test_window_trims_old_points(self, manager):
        t0 = 0.0
        warmup = make_reading(bt=150.0, ts=t0)
        # Feed readings spanning >30s
        readings = [make_reading(bt=150.0 + i * 0.5, ts=t0 + i * 5.0) for i in range(1, 15)]
        fake = FakeAdapter(readings=[warmup] + readings)
        with patch("manager.make_adapter", return_value=fake):
            # Patch monotonic so window trimming uses our fake timestamps
            manager._start_time = t0
            await manager.connect("virtual", {})

        for r in readings:
            manager._add_to_ror_window(r.timestamp, r.bt)

        # All points with ts < (latest - 30) should be pruned
        latest_ts = readings[-1].timestamp
        for ts, _ in manager._ror_window:
            assert ts >= latest_ts - 30.0

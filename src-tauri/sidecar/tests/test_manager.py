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


# ---------------------------------------------------------------------------
# _reconnect_loop — infinite retry
# ---------------------------------------------------------------------------

class FlakyConnectAdapter:
    """connect가 fail_times번 실패한 뒤 성공하는 페이크."""

    def __init__(self, fail_times: int):
        self._remaining_failures = fail_times
        self.connect_call_count = 0
        self.connected = False

    async def connect(self) -> None:
        self.connect_call_count += 1
        if self._remaining_failures > 0:
            self._remaining_failures -= 1
            raise ConnectionError("simulated failure")
        self.connected = True

    async def disconnect(self) -> None:
        self.connected = False

    async def read(self):
        raise RuntimeError("not used")


class TestInfiniteReconnect:
    async def test_reconnect_survives_more_than_three_failures(self, manager, monkeypatch):
        """백오프 3회 소진 후에도 포기하지 않고 마지막 간격으로 계속 재시도한다."""
        import config
        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01, 0.01, 0.01])

        adapter = FlakyConnectAdapter(fail_times=5)  # 기존 로직이면 3회 후 포기 → 실패
        manager._adapter = adapter
        manager._connected = False
        manager._roaster_key = "test"
        manager._protocol = "virtual"
        manager._merged_params = {}

        manager._reconnect_task = asyncio.create_task(manager._reconnect_loop())
        await asyncio.wait_for(manager._reconnect_task, timeout=2.0)

        assert manager._connected is True
        assert adapter.connect_call_count == 6  # 실패 5 + 성공 1
        assert manager._error is None
        assert manager._reconnect_attempt == 0

    async def test_reconnect_stops_when_adapter_removed(self, manager, monkeypatch):
        """disconnect로 어댑터가 제거되면 루프가 종료된다."""
        import config
        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01])

        adapter = FlakyConnectAdapter(fail_times=10_000)
        manager._adapter = adapter
        manager._connected = False

        task = asyncio.create_task(manager._reconnect_loop())
        await asyncio.sleep(0.05)
        manager._adapter = None  # disconnect 상당
        await asyncio.wait_for(task, timeout=2.0)
        assert manager._reconnect_attempt == 0


# ---------------------------------------------------------------------------
# TestReconnectStateReset — RoR/EMA cleared on successful auto-reconnect
# ---------------------------------------------------------------------------

class TestReconnectStateReset:
    async def test_ror_state_cleared_on_successful_reconnect(self, manager, monkeypatch):
        """재연결 성공 시 RoR 윈도우와 EMA 상태를 초기화해야 한다.

        재연결 전 RoR 윈도우에 쌓인 데이터는 연결 끊김 동안의 시간을
        포함하므로, 재연결 후 그대로 사용하면 RoR 계산이 왜곡된다.
        """
        import config
        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01])

        adapter = FlakyConnectAdapter(fail_times=0)  # 즉시 성공
        manager._adapter = adapter
        manager._connected = False
        manager._roaster_key = "test"
        manager._protocol = "virtual"
        manager._merged_params = {}

        # Populate stale RoR state spanning the disconnect gap
        t = time.monotonic()
        manager._ror_window.append((t - 20.0, 150.0))
        manager._ror_window.append((t - 10.0, 155.0))
        manager._et_ror_window.append((t - 20.0, 200.0))
        manager._bt_ema = 152.0
        manager._et_ema = 202.0
        manager._bt_display_ema = 155.0
        manager._et_display_ema = 200.0
        manager._ror_warmup = 0  # warmup consumed — stale window would give wrong RoR

        manager._reconnect_task = asyncio.create_task(manager._reconnect_loop())
        await asyncio.wait_for(manager._reconnect_task, timeout=2.0)

        assert manager._connected is True
        assert len(manager._ror_window) == 0, "RoR 윈도우가 초기화되어야 한다"
        assert len(manager._et_ror_window) == 0, "ET RoR 윈도우가 초기화되어야 한다"
        assert manager._bt_ema is None, "BT EMA가 초기화되어야 한다"
        assert manager._et_ema is None, "ET EMA가 초기화되어야 한다"
        assert manager._bt_display_ema is None, "BT display EMA가 초기화되어야 한다"
        assert manager._et_display_ema is None, "ET display EMA가 초기화되어야 한다"
        assert manager._ror_warmup == config.ROR_WARMUP_READS, "RoR warmup이 재설정되어야 한다"


# ---------------------------------------------------------------------------
# TestManagerStaleData
# ---------------------------------------------------------------------------

class TestManagerStaleData:
    async def _connect_with(self, manager, adapter):
        """레지스트리를 거치지 않고 어댑터를 직접 주입해 연결 상태를 만든다."""
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "virtual"
        manager._merged_params = {}

    async def test_returns_stale_reading_within_tolerance(self, manager):
        adapter = FakeAdapter(readings=[make_reading(bt=180.0, et=220.0)])
        await self._connect_with(manager, adapter)

        first = await manager.read_temperatures()
        assert first["stale"] is False
        assert first["bt"] == 180.0

        # 다음 read는 실패(소진) → 3회까지 이전 값 유지
        for i in range(3):
            data = await manager.read_temperatures()
            assert data["stale"] is True, f"{i + 1}번째 실패에서 stale 유지돼야 함"
            assert data["bt"] == 180.0
            assert manager._connected is True  # 아직 연결 유지

        # 4번째 실패 → 기존 에러 경로 (null + 재연결 트리거)
        data = await manager.read_temperatures()
        assert data["bt"] is None
        assert manager._connected is False
        assert manager._reconnect_task is not None
        manager._reconnect_task.cancel()

    async def test_success_resets_error_counter(self, manager):
        adapter = FakeAdapter(readings=[make_reading(bt=180.0)])  # 1회 성공 후 소진
        await self._connect_with(manager, adapter)
        await manager.read_temperatures()           # 성공
        await manager.read_temperatures()           # 실패 1 (stale)
        adapter._readings.append(make_reading(bt=181.0))  # 다시 성공 가능
        data = await manager.read_temperatures()
        assert data["stale"] is False
        assert manager._consecutive_errors == 0

    async def test_no_stale_without_prior_good_reading(self, manager):
        """첫 read부터 실패하면 유지할 값이 없으므로 즉시 에러 경로."""
        adapter = FakeAdapter(readings=[])
        await self._connect_with(manager, adapter)
        data = await manager.read_temperatures()
        assert data["bt"] is None
        assert manager._connected is False
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()

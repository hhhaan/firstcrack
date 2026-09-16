"""Unit tests for RoasterManager."""
import asyncio
import time
from collections import deque
from unittest.mock import patch

import pytest

import config
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

    async def test_connected_true_on_transport_success(self, manager):
        """소켓 연결 성공 시 bt=0이어도 connected=True (Artisan 동작과 일치)."""
        fake = FakeAdapter(readings=[make_reading(bt=0.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager.status()["connected"] is True

    async def test_connected_true_after_positive_bt(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager.status()["connected"] is True

    async def test_disconnect_resets_connected(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        await manager.disconnect()
        assert manager.status()["connected"] is False

    async def test_reset_clears_last_applied_setpoint(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        await manager.control(heater=70)

        await manager.reset_roast()

        assert manager.last_applied() == {}

    async def test_disconnect_stops_pid_at_zero_before_teardown(self, manager):
        """#219: disconnect must write heater 0 while control() still accepts writes."""
        from pid_runner import STOP_ZERO

        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})

        order: list[str] = []

        class _Pid:
            async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
                order.append(f"stop:{reason}:{mode}:connected={manager._connected}")
                await fake.control(heater=0.0)

        manager._pid = _Pid()
        await manager.disconnect()

        assert order == [f"stop:disconnect:{STOP_ZERO}:connected=True"]
        assert fake.control_calls[-1]["heater"] == 0.0
        assert manager._pid is None
        assert manager.status()["connected"] is False

    async def test_disconnect_continues_if_pid_stop_raises(self, manager):
        fake = FakeAdapter(readings=[make_reading(bt=150.0)])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})

        class _Pid:
            async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
                raise RuntimeError("adapter gone")

        manager._pid = _Pid()
        await manager.disconnect()
        assert manager.status()["connected"] is False
        assert fake.disconnected is True

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
        # Window should have been cleared on reconnect (no warmup read)
        assert len(manager._ror_window) == 0


# ---------------------------------------------------------------------------
# read_temperatures()
# ---------------------------------------------------------------------------

class TestReadTemperatures:
    async def test_returns_none_when_not_connected(self, manager):
        result = await manager.read_temperatures()
        assert result["bt"] is None
        assert result["bt_raw"] is None
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

    async def test_raw_bt_is_unsmoothed_and_stale_is_flagged(self, manager):
        manager._adapter = FakeAdapter(readings=[
            make_reading(bt=200.0, ts=10.0),
            make_reading(bt=197.25, ts=11.0),
        ])
        manager._connected = True
        await manager.read_temperatures()
        reading = await manager.read_temperatures()
        assert reading["bt_raw"] == 197.25
        assert 197.25 < reading["bt"] < 200
        assert reading["timestamp"] == 11.0
        stale = await manager.read_temperatures()
        assert stale["stale"] is True
        assert stale["bt_raw"] == 197.25

    async def test_heater_none_is_not_reported_as_zero(self, manager):
        """화력 피드백 채널이 없는 머신은 None으로 나가야 한다.

        0으로 채우면 TSV에 '측정 0'으로 남아, 그 프로파일을 쓰기 가능한 머신에서
        Replay 레퍼런스로 쓸 때 charge 직후 화력 0이 나간다.
        """
        reading = make_reading(bt=185.0, et=220.0, ts=time.monotonic())
        reading = Reading(
            bt=reading.bt, et=reading.et, heater=None,
            fan=reading.fan, drum=reading.drum, timestamp=reading.timestamp,
        )
        fake = FakeAdapter(readings=[reading, reading])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        result = await manager.read_temperatures()
        assert result["heater"] is None
        assert result["fan"] == int(round(reading.fan))

    async def test_heater_zero_is_preserved_as_zero(self, manager):
        """진짜 측정 0은 그대로 0 — None과 구분된다."""
        base = make_reading(bt=185.0, et=220.0, ts=time.monotonic())
        reading = Reading(
            bt=base.bt, et=base.et, heater=0.0,
            fan=base.fan, drum=base.drum, timestamp=base.timestamp,
        )
        fake = FakeAdapter(readings=[reading, reading])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert (await manager.read_temperatures())["heater"] == 0

    async def test_read_failure_sets_not_connected(self, manager):
        fake = FakeAdapter(readings=[])  # no readings → read() will raise
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager._connected is True

        await manager.read_temperatures()  # RuntimeError from FakeAdapter
        assert manager._connected is False

    async def test_read_failure_spawns_reconnect_task(self, manager):
        fake = FakeAdapter(readings=[])  # no readings → read() will raise
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

    async def control(self, heater=None, fan=None, drum=None) -> None:
        self.control_calls = getattr(self, "control_calls", [])
        self.control_calls.append({"heater": heater, "fan": fan, "drum": drum})


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

    async def test_reconnect_zeros_heater_and_stops_fault_pid(self, manager, monkeypatch):
        """#205: reconnect must write heater 0 and leave FAULT via STOP_ZERO."""
        import config
        from pid_runner import STOP_ZERO

        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01])
        adapter = FlakyConnectAdapter(fail_times=0)
        manager._adapter = adapter
        manager._connected = False
        manager._roaster_key = "test"
        manager._protocol = "virtual"
        manager._merged_params = {}

        class _FaultPid:
            state_name = "fault"
            stopped: tuple[str, str] | None = None

            async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
                self.stopped = (reason, mode)
                self.state_name = "off"

        pid = _FaultPid()
        manager._pid = pid
        manager._reconnect_task = asyncio.create_task(manager._reconnect_loop())
        await asyncio.wait_for(manager._reconnect_task, timeout=2.0)

        assert manager._connected is True
        assert pid.stopped == ("reconnect", STOP_ZERO)
        assert adapter.control_calls[-1]["heater"] == 0.0


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

    async def test_first_read_failure_gets_serial_hint_message(self, manager):
        """첫 read 실패(연결은 됐지만 응답 없음) + serial(rtu/ascii) → 설정 불일치 안내 메시지."""
        adapter = FakeAdapter(readings=[])
        await self._connect_with(manager, adapter)
        manager._protocol = "modbus"
        manager._merged_params = {"mode": "rtu"}
        await manager.read_temperatures()
        assert "연결 방식(RTU/ASCII)" in manager._error
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()

    async def test_first_read_failure_gets_network_hint_message(self, manager):
        """첫 read 실패 + tcp/udp → Unit ID/레지스터 안내 메시지."""
        adapter = FakeAdapter(readings=[])
        await self._connect_with(manager, adapter)
        manager._protocol = "modbus"
        manager._merged_params = {"mode": "tcp"}
        await manager.read_temperatures()
        assert "Unit ID" in manager._error
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()

    async def test_subsequent_read_failure_keeps_generic_message(self, manager):
        """이전 정상 값이 있던 상태(로스팅 중 끊김)에서는 기존 메시지 경로 유지."""
        adapter = FakeAdapter(readings=[make_reading(bt=180.0)])
        await self._connect_with(manager, adapter)
        manager._protocol = "modbus"
        manager._merged_params = {"mode": "rtu"}
        await manager.read_temperatures()  # 성공 → _last_good 세팅
        for _ in range(config.STALE_TOLERANCE_READS):
            await manager.read_temperatures()  # stale 소진
        data = await manager.read_temperatures()  # 최종 실패 → disconnect
        assert data["bt"] is None
        assert "연결 방식(RTU/ASCII)" not in manager._error
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()


# ---------------------------------------------------------------------------
# BT 유효성 검증 — 어댑터가 예외 대신 센티넬을 반환하는 silent fail (H1)
# ---------------------------------------------------------------------------

class TestBtValidation:
    async def _connect_with(self, manager, adapter):
        manager._adapter = adapter
        manager._connected = True
        manager._protocol = "virtual"
        manager._merged_params = {}

    @pytest.mark.parametrize("bad_bt", [-1.0, 0.0, 400.0, 1372.0, float("nan"), float("inf")])
    async def test_invalid_bt_is_treated_as_read_failure(self, manager, bad_bt):
        """센티넬/NaN/범위 밖 BT는 성공이 아니라 stale로 표면화돼야 한다."""
        adapter = FakeAdapter(readings=[make_reading(bt=180.0), make_reading(bt=bad_bt)])
        await self._connect_with(manager, adapter)

        good = await manager.read_temperatures()
        assert good["stale"] is False

        data = await manager.read_temperatures()
        assert data["stale"] is True, f"bt={bad_bt}는 실패로 처리돼야 한다"
        assert manager._consecutive_errors == 1

    async def test_sentinel_bt_eventually_disconnects(self, manager):
        """센티넬이 계속 오면 tolerance 소진 후 재연결 루프로 넘어간다."""
        import config

        readings = [make_reading(bt=180.0)] + [
            make_reading(bt=-1.0) for _ in range(config.STALE_TOLERANCE_READS + 1)
        ]
        adapter = FakeAdapter(readings=readings)
        await self._connect_with(manager, adapter)

        await manager.read_temperatures()  # 정상 1회
        for _ in range(config.STALE_TOLERANCE_READS):
            assert (await manager.read_temperatures())["stale"] is True

        data = await manager.read_temperatures()
        assert data["bt"] is None
        assert manager._connected is False
        assert manager._reconnect_task is not None
        manager._reconnect_task.cancel()

    async def test_et_sentinel_does_not_fail_read(self, manager):
        """ET는 선택 채널 — -1.0이어도 세션을 죽이지 않는다."""
        adapter = FakeAdapter(readings=[make_reading(bt=180.0, et=-1.0)])
        await self._connect_with(manager, adapter)

        data = await manager.read_temperatures()
        assert data["stale"] is False
        assert data["bt"] == 180.0
        assert manager._connected is True

    async def test_bounds_come_from_config(self, manager, monkeypatch):
        """임계값은 config로 조정 가능해야 한다 (실기기 튜닝 포인트)."""
        import config

        monkeypatch.setattr(config, "BT_VALID_MAX_C", 100.0)
        adapter = FakeAdapter(readings=[make_reading(bt=180.0)])
        await self._connect_with(manager, adapter)

        data = await manager.read_temperatures()
        assert data["bt"] is None  # 상한을 낮추면 정상 로스팅 온도도 실패로 본다
        assert manager._connected is False
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()


# ---------------------------------------------------------------------------
# read 타임아웃 (H7) / disconnect 경합 (H4)
# ---------------------------------------------------------------------------

class HangingAdapter:
    """read()가 영원히 끝나지 않는 어댑터."""

    def __init__(self) -> None:
        self.connected = True

    async def connect(self) -> None:
        self.connected = True

    async def disconnect(self) -> None:
        self.connected = False

    async def read(self):
        await asyncio.sleep(3600)


class TestReadTimeout:
    async def test_hanging_read_times_out(self, manager, monkeypatch):
        import config

        monkeypatch.setattr(config, "READ_TIMEOUT", 0.05)
        manager._adapter = HangingAdapter()
        manager._connected = True
        manager._protocol = "virtual"
        manager._merged_params = {}

        data = await asyncio.wait_for(manager.read_temperatures(), timeout=1.0)
        assert data["bt"] is None
        assert manager._connected is False
        if manager._reconnect_task is not None:
            manager._reconnect_task.cancel()


class TestDisconnectRace:
    async def test_read_success_after_disconnect_is_discarded(self, manager):
        """read await 중 disconnect되면 성공 응답도 버리고 _last_good을 오염시키지 않는다."""

        class DisconnectingAdapter:
            connected = True

            async def connect(self) -> None:
                pass

            async def disconnect(self) -> None:
                pass

            async def read(inner):
                manager._adapter = None  # await 도중 /disconnect 상당
                return make_reading(bt=180.0)

        manager._adapter = DisconnectingAdapter()
        manager._connected = True

        data = await manager.read_temperatures()
        assert data["bt"] is None
        assert manager._last_good is None
        assert manager._reconnect_task is None

    async def test_read_failure_after_disconnect_is_silent(self, manager):
        """read 실패 시점에 어댑터가 이미 사라졌으면 재연결을 띄우지 않는다."""

        class FailingAfterDisconnect:
            connected = True

            async def connect(self) -> None:
                pass

            async def disconnect(self) -> None:
                pass

            async def read(inner):
                manager._adapter = None
                raise ConnectionError("cable pulled")

        manager._adapter = FailingAfterDisconnect()
        manager._connected = True

        data = await manager.read_temperatures()
        assert data["bt"] is None
        assert manager._consecutive_errors == 0
        assert manager._reconnect_task is None

    async def test_control_after_disconnect_is_silent(self, manager):
        class ControlFailsAfterDisconnect:
            connected = True

            async def control(inner, heater=None, fan=None, drum=None):
                manager._adapter = None
                raise ConnectionError("cable pulled")

        manager._adapter = ControlFailsAfterDisconnect()
        manager._connected = True
        manager._protocol = "virtual"
        manager._merged_params = {"write_map": {"heater": {"min": 0, "max": 100}}}
        assert await manager.control(heater=50) == {}  # 예외가 새어나오지 않아야 한다

    async def test_control_success_after_disconnect_does_not_restore_setpoint(self, manager):
        started = asyncio.Event()
        release = asyncio.Event()

        class DelayedControl:
            async def control(inner, heater=None, fan=None, drum=None):
                started.set()
                await release.wait()

            async def disconnect(inner):
                pass

        manager._adapter = DelayedControl()
        manager._connected = True
        manager._protocol = "virtual"
        manager._merged_params = {"write_map": {"heater": {"min": 0, "max": 100}}}

        control_task = asyncio.create_task(manager.control(heater=73))
        await started.wait()
        await manager.disconnect()
        assert manager.last_applied() == {}

        with patch("manager.make_adapter", return_value=FakeAdapter()):
            await manager.connect("virtual", {})
        assert manager.last_applied() == {}

        release.set()
        assert await control_task == {}
        assert manager.last_applied() == {}

    async def test_control_breadcrumb_has_roaster_protocol_roles_not_values(self, manager):
        fake = FakeAdapter()
        manager._adapter = fake
        manager._connected = True
        manager._roaster_key = "giesen_w6a"
        manager._protocol = "s7"
        manager._merged_params = {"write_map": {"heater": {"min": 0, "max": 100}}}
        with patch("manager.sentry_sdk.add_breadcrumb") as breadcrumb:
            applied = await manager.control(heater=47)
        assert applied == {"heater": 47.0}
        kwargs = breadcrumb.call_args.kwargs
        assert kwargs["category"] == "control"
        assert kwargs["message"] == "control write ok"
        assert kwargs["data"] == {
            "roaster": "giesen_w6a",
            "protocol": "s7",
            "roles": ["heater"],
        }
        assert "47" not in repr(kwargs["data"])

    async def test_control_write_failure_breadcrumb_omits_values(self, manager):
        class Boom:
            async def control(inner, heater=None, fan=None, drum=None):
                raise OSError("PLC unreachable")

        manager._adapter = Boom()
        manager._connected = True
        manager._roaster_key = "giesen_w6a"
        manager._protocol = "s7"
        manager._merged_params = {"write_map": {"heater": {"min": 0, "max": 100}}}
        with patch("manager.sentry_sdk.add_breadcrumb") as breadcrumb:
            with pytest.raises(OSError):
                await manager.control(heater=47)
        kwargs = breadcrumb.call_args.kwargs
        assert kwargs["message"] == "control write failed"
        assert kwargs["data"]["roles"] == ["heater"]
        assert "47" not in repr(kwargs["data"])


# ---------------------------------------------------------------------------
# TestConnectCancellation (#208) — disconnect가 진행 중인 연결 시도를 취소한다
# ---------------------------------------------------------------------------

class TestConnectCancellation:
    async def _start_gated_connect(self, manager, fake):
        """어댑터 핸드셰이크 한가운데서 멈춘 connect 태스크를 만든다."""
        with patch("manager.make_adapter", return_value=fake):
            task = asyncio.create_task(manager.connect("virtual", {}))
            await asyncio.wait_for(fake.connect_started.wait(), timeout=1.0)
            return task

    async def test_disconnect_cancels_inflight_connect(self, manager):
        """핸드셰이크 중 disconnect가 락을 기다리지 않고 즉시 완료돼야 한다."""
        fake = FakeAdapter(connect_gate=asyncio.Event())
        task = await self._start_gated_connect(manager, fake)

        await asyncio.wait_for(manager.disconnect(), timeout=0.5)
        await asyncio.wait_for(task, timeout=1.0)  # connect()는 예외를 밖으로 내지 않는다

        assert fake.connect_cancelled is True
        assert fake.disconnected is True

    async def test_cancelled_connect_leaves_clean_state(self, manager):
        """취소는 실패가 아니다 — _error가 세워지면 UI에 오답 배너가 뜬다."""
        fake = FakeAdapter(connect_gate=asyncio.Event())
        task = await self._start_gated_connect(manager, fake)

        await asyncio.wait_for(manager.disconnect(), timeout=0.5)
        await asyncio.wait_for(task, timeout=1.0)

        status = manager.status()
        assert status["connected"] is False
        assert status["error"] is None
        assert status["roaster"] == ""
        assert manager._adapter is None
        assert manager._connect_task is None
        assert manager._connect_cancel_requested is False

    async def test_reconnect_loop_connect_is_cancellable(self, manager, monkeypatch):
        """재연결 루프가 락을 쥔 채 connect 중이어도 disconnect가 풀려야 한다.

        기존 코드에서는 재연결 취소 코드가 _disconnect_internal(= 락 획득 후)에
        있어 서로를 기다리는 구조적 데드락이었다.
        """
        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01])

        fake = FakeAdapter(connect_gate=asyncio.Event())
        manager._adapter = fake
        manager._connected = False
        manager._roaster_key = "test"
        manager._protocol = "virtual"
        manager._merged_params = {}

        manager._reconnect_task = asyncio.create_task(manager._reconnect_loop())
        await asyncio.wait_for(fake.connect_started.wait(), timeout=1.0)

        await asyncio.wait_for(manager.disconnect(), timeout=0.5)

        assert fake.connect_cancelled is True
        assert manager._adapter is None
        assert manager._connected is False
        assert manager._reconnect_attempt == 0

    async def test_successful_connect_clears_task_handle(self, manager):
        fake = FakeAdapter(readings=[make_reading()])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        assert manager._connected is True
        assert manager._connect_task is None
        assert manager._connect_cancel_requested is False

    async def test_handler_cancel_propagates(self, manager):
        """클라이언트 소켓이 끊겨 요청 핸들러가 취소된 경우는 ConnectCancelled가 아니다."""
        fake = FakeAdapter(connect_gate=asyncio.Event())
        task = await self._start_gated_connect(manager, fake)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1.0)

    async def test_disconnect_is_idempotent(self, manager):
        fake = FakeAdapter(connect_gate=asyncio.Event())
        task = await self._start_gated_connect(manager, fake)

        await asyncio.wait_for(manager.disconnect(), timeout=0.5)
        await asyncio.wait_for(manager.disconnect(), timeout=0.5)  # 2연타 no-op
        await asyncio.wait_for(task, timeout=1.0)
        assert manager._adapter is None


# ---------------------------------------------------------------------------
# enter_standby lock + connected guard (#213-3)
# ---------------------------------------------------------------------------

class TestEnterStandby:
    async def test_enter_standby_no_adapter_does_not_raise(self, manager):
        await manager.enter_standby()

    async def test_enter_standby_skips_when_not_connected(self, manager):
        called = False

        class Adapter:
            async def enter_standby(self):
                nonlocal called
                called = True

        manager._adapter = Adapter()
        manager._connected = False
        await manager.enter_standby()
        assert called is False

    async def test_enter_standby_calls_adapter_when_connected(self, manager):
        called = False

        class Adapter:
            async def enter_standby(self):
                nonlocal called
                called = True

        manager._adapter = Adapter()
        manager._connected = True
        await manager.enter_standby()
        assert called is True

    async def test_enter_standby_waits_for_connect_lock(self, manager):
        """락이 실제로 배타를 거는지 — 나머지 케이스는 가드만 보고 이건 락을 본다."""
        gate = asyncio.Event()
        fake = FakeAdapter(connect_gate=gate)
        called = asyncio.Event()

        async def _enter_standby():
            called.set()

        fake.enter_standby = _enter_standby

        with patch("manager.make_adapter", return_value=fake):
            conn = asyncio.create_task(manager.connect("virtual", {}))
            await asyncio.wait_for(fake.connect_started.wait(), timeout=1.0)

            standby = asyncio.create_task(manager.enter_standby())
            await asyncio.sleep(0)
            assert not called.is_set(), "connect가 _lock을 쥔 동안 진입했다"

            gate.set()
            await asyncio.wait_for(conn, timeout=1.0)
            await asyncio.wait_for(standby, timeout=1.0)

        assert called.is_set()


# ---------------------------------------------------------------------------
# _capture_hardware_error once=
# ---------------------------------------------------------------------------

class TestHardwareAlertDedupe:
    async def test_once_emits_first_then_breadcrumbs(self, manager):
        exc = OSError("PLC unreachable")
        with (
            patch("manager.sentry_sdk.capture_exception") as capture,
            patch("manager.sentry_sdk.add_breadcrumb") as breadcrumb,
        ):
            manager._capture_hardware_error(exc, "pid_request_failed", once=True)
            manager._capture_hardware_error(exc, "pid_request_failed", once=True)
        assert capture.call_count == 1
        assert breadcrumb.call_count == 1
        assert "duplicate suppressed" in breadcrumb.call_args.kwargs["message"]

    async def test_once_false_always_emits(self, manager):
        exc = OSError("PLC unreachable")
        with patch("manager.sentry_sdk.capture_exception") as capture:
            manager._capture_hardware_error(exc, "connect_failed")
            manager._capture_hardware_error(exc, "connect_failed")
        assert capture.call_count == 2

    async def test_pid_stop_success_allows_next_incident(self, manager):
        class _Pid:
            async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
                return None

            def state(self):
                return {"state": "off", "error": None}

        manager._pid = _Pid()
        manager._hw_alerts_sent.add("pid_request_failed")
        await manager.pid_stop("zero")
        assert "pid_request_failed" not in manager._hw_alerts_sent

    async def test_disconnect_clears_sent_alerts(self, manager):
        manager._hw_alerts_sent.add("pid_request_failed")
        await manager.disconnect()
        assert manager._hw_alerts_sent == set()

    async def test_reconnect_loop_captures_once_per_incident(self, manager, monkeypatch):
        """무한 재시도 루프가 실패마다 이슈를 만들면 안 된다 — 사고 1건 = 이슈 1건."""
        import config

        monkeypatch.setattr(config, "RECONNECT_BACKOFFS", [0.01, 0.01, 0.01])
        adapter = FlakyConnectAdapter(fail_times=5)
        manager._adapter = adapter
        manager._connected = False
        manager._roaster_key = "test"
        manager._protocol = "virtual"
        manager._merged_params = {}

        with patch("manager.sentry_sdk.capture_exception") as capture:
            manager._reconnect_task = asyncio.create_task(manager._reconnect_loop())
            await asyncio.wait_for(manager._reconnect_task, timeout=2.0)

        assert adapter.connect_call_count == 6
        assert capture.call_count == 1
        # 재연결에 성공했으니 다음 사고는 다시 알릴 수 있어야 한다
        assert "reconnect_failed" not in manager._hw_alerts_sent

    async def test_capture_omits_host_and_comport(self, manager):
        manager._roaster_key = "test"
        manager._protocol = "modbus_tcp"
        manager._merged_params = {"mode": "tcp", "host": "10.0.0.2", "comport": "COM3"}
        with (
            patch("manager.sentry_sdk.capture_exception"),
            patch("manager.sentry_sdk.set_context") as set_context,
        ):
            manager._capture_hardware_error(OSError("PLC unreachable"), "connect_failed")
        dumped = repr(set_context.call_args_list)
        assert "10.0.0.2" not in dumped
        assert "COM3" not in dumped


class TestSafetyAfterReconnect:
    """재연결 safe-off는 PID가 화력을 잡고 있을 때만 — 껐다 둔 PID 객체가 남아 있어도 수동/Replay 화력을 덮지 않는다."""

    class _Pid:
        def __init__(self, state: str) -> None:
            self.state_name = state
            self.stopped: list[tuple[str, str]] = []

        async def stop(self, reason: str = "user", *, mode: str = "hold") -> None:
            self.stopped.append((reason, mode))

    async def _connected(self, manager):
        fake = FakeAdapter(readings=[make_reading(ts=time.monotonic())])
        with patch("manager.make_adapter", return_value=fake):
            await manager.connect("virtual", {})
        return fake

    async def test_pid_never_used_keeps_heater(self, manager):
        fake = await self._connected(manager)
        await manager._safety_after_reconnect()
        assert fake.control_calls == []

    async def test_pid_stopped_keeps_heater(self, manager):
        fake = await self._connected(manager)
        pid = self._Pid("off")
        manager._pid = pid
        await manager._safety_after_reconnect()
        assert fake.control_calls == []
        assert pid.stopped == []

    async def test_pid_running_is_zeroed(self, manager):
        fake = await self._connected(manager)
        pid = self._Pid("running")
        manager._pid = pid
        await manager._safety_after_reconnect()
        assert pid.stopped == [("reconnect", "zero")]
        assert fake.control_calls == [{"heater": 0.0, "fan": None, "drum": None}]

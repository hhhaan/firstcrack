"""Behavioral tests for S7Adapter write path.

snap7 클라이언트만 MagicMock으로 대체하고 어댑터 로직(클램프, 스케일 역변환,
INT/REAL 인코딩, 락 직렬화)은 실제로 돌린다. 하드웨어 불필요.
"""

import asyncio
import sys
import threading
import time
from unittest.mock import MagicMock

import pytest
from snap7.util.getters import get_int, get_real
from snap7.util.setters import set_int

import config
from adapters.s7 import S7Adapter


GIESEN_CHANNELS = [
    {"role": "BT", "db": 3, "offset": 116, "area": 6, "type": 1, "div": 0},
    {"role": "ET", "db": 3, "offset": 112, "area": 6, "type": 1, "div": 0},
    {"role": "heater", "db": 2, "offset": 48, "area": 6, "type": 0, "div": 0},
    {"role": "fan", "db": 2, "offset": 10, "area": 6, "type": 0, "div": 0},
    {"role": "drum", "db": 2, "offset": 18, "area": 6, "type": 0, "div": 0},
]

GIESEN_WRITE_MAP = {
    "heater": {"db": 2, "offset": 14, "area": 6, "type": 0, "div": 0,
               "min": 0, "max": 100, "unit": "%"},
}


def _int_bytes(value: int) -> bytearray:
    ba = bytearray(2)
    set_int(ba, 0, value)
    return ba


def _install_snap7(monkeypatch):
    """connect() 내부 `import snap7`만 가로챈다. util getters/setters는 실제 모듈."""
    snap7 = MagicMock()
    client = MagicMock()
    client.get_connected.return_value = True
    client.get_cpu_state.return_value = "S7CpuStatusRun"
    client.db_read.side_effect = lambda db, offset, size: bytearray(size)
    snap7.client.Client.return_value = client
    snap7.type.Parameter.RecvTimeout = "RecvTimeout"
    monkeypatch.setitem(sys.modules, "snap7", snap7)
    return snap7, client


@pytest.fixture
def adapter():
    a = S7Adapter(host="127.0.0.1", channels=GIESEN_CHANNELS, write_map=GIESEN_WRITE_MAP)
    plc = MagicMock()
    plc.get_connected.return_value = True
    plc.get_cpu_state.return_value = "S7CpuStatusRun"
    plc.db_read.side_effect = lambda db, offset, size: bytearray(size)
    a._plc = plc
    a._min_interval = 0.0  # 스로틀은 이 테스트의 대상이 아님
    a._cache_channels()
    return a


def _written(plc) -> tuple[int, int, bytearray]:
    """마지막 db_write 인자 (db, offset, payload)."""
    args = plc.db_write.call_args.args
    return args[0], args[1], args[2]


class TestControlWrite:
    async def test_writes_heater_to_write_map_cell(self, adapter):
        await adapter.control(heater=63.0)
        db, offset, payload = _written(adapter._plc)
        assert (db, offset) == (2, 14)
        assert len(payload) == 2
        assert get_int(payload, 0) == 63

    async def test_clamps_above_max(self, adapter):
        await adapter.control(heater=150.0)
        assert get_int(_written(adapter._plc)[2], 0) == 100

    async def test_clamps_below_min(self, adapter):
        await adapter.control(heater=-10.0)
        assert get_int(_written(adapter._plc)[2], 0) == 0

    async def test_rounds_to_nearest_int(self, adapter):
        await adapter.control(heater=62.6)
        assert get_int(_written(adapter._plc)[2], 0) == 63

    async def test_skips_roles_absent_from_write_map(self, adapter):
        await adapter.control(fan=50.0, drum=45.0)
        adapter._plc.db_write.assert_not_called()

    async def test_writes_only_requested_role(self, adapter):
        await adapter.control(heater=40.0, fan=50.0)
        assert adapter._plc.db_write.call_count == 1
        assert _written(adapter._plc)[1] == 14

    async def test_noop_when_plc_none(self, adapter):
        plc = adapter._plc
        adapter._plc = None
        await adapter.control(heater=50.0)
        plc.db_write.assert_not_called()

    async def test_noop_when_no_value_requested(self, adapter):
        await adapter.control()
        adapter._plc.db_write.assert_not_called()

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    async def test_rejects_non_finite(self, adapter, bad):
        with pytest.raises(ValueError):
            await adapter.control(heater=bad)
        adapter._plc.db_write.assert_not_called()


class TestScalingAndEncoding:
    async def test_inverts_div_scaling(self):
        """읽기가 ÷10이면 쓰기는 ×10."""
        a = S7Adapter(channels=GIESEN_CHANNELS, write_map={
            "heater": {"db": 2, "offset": 14, "type": 0, "div": 1, "min": 0, "max": 100},
        })
        a._plc = MagicMock()
        a._min_interval = 0.0
        await a.control(heater=12.3)
        assert get_int(_written(a._plc)[2], 0) == 123

    async def test_writes_real_as_four_bytes(self):
        a = S7Adapter(channels=GIESEN_CHANNELS, write_map={
            "heater": {"db": 1001, "offset": 24, "type": 1, "div": 0, "min": 0, "max": 100},
        })
        a._plc = MagicMock()
        a._min_interval = 0.0
        await a.control(heater=42.5)
        db, offset, payload = _written(a._plc)
        assert (db, offset) == (1001, 24)
        assert len(payload) == 4
        assert get_real(payload, 0) == pytest.approx(42.5)

    async def test_int16_overflow_guard(self):
        """스케일 후 INT16을 넘으면 랩어라운드 대신 예외."""
        a = S7Adapter(channels=GIESEN_CHANNELS, write_map={
            "heater": {"db": 2, "offset": 14, "type": 0, "div": 2, "min": 0, "max": 100000},
        })
        a._plc = MagicMock()
        a._min_interval = 0.0
        with pytest.raises(ValueError, match="INT16"):
            await a.control(heater=1000.0)  # ×100 = 100000 > 32767
        a._plc.db_write.assert_not_called()

    async def test_no_min_max_means_no_clamp(self):
        a = S7Adapter(channels=GIESEN_CHANNELS, write_map={
            "heater": {"db": 2, "offset": 14, "type": 0, "div": 0},
        })
        a._plc = MagicMock()
        a._min_interval = 0.0
        await a.control(heater=250.0)
        assert get_int(_written(a._plc)[2], 0) == 250


class TestReadRawChannel:
    async def test_returns_decoded_feedback(self, adapter):
        adapter._plc.db_read.side_effect = lambda db, offset, size: _int_bytes(72)
        value = await adapter.read_raw_channel("heater")
        assert value == 72.0
        assert adapter._plc.db_read.call_args.args[:2] == (2, 48)

    async def test_returns_none_for_unmapped_role(self, adapter):
        assert await adapter.read_raw_channel("pressure") is None

    async def test_returns_none_when_disconnected(self, adapter):
        adapter._plc = None
        assert await adapter.read_raw_channel("heater") is None


class TestIoSerialization:
    async def test_read_and_control_never_interleave(self, adapter):
        """snap7 클라이언트는 스레드 세이프하지 않다 — 락으로 직렬화돼야 한다."""
        events: list[str] = []

        def slow_read(db, offset, size):
            events.append("read_start")
            # executor 스레드가 실제로 겹칠 시간을 준다
            import time
            time.sleep(0.02)
            events.append("read_end")
            return _int_bytes(0) if size == 2 else bytearray(4)

        def record_write(db, offset, payload):
            events.append("write")

        adapter._plc.db_read.side_effect = slow_read
        adapter._plc.db_write.side_effect = record_write

        await asyncio.gather(adapter.read(), adapter.control(heater=50.0))

        # write가 read_start와 read_end 사이에 끼면 안 된다
        for i, ev in enumerate(events):
            if ev != "write":
                continue
            before = events[:i]
            assert before.count("read_start") == before.count("read_end"), (
                f"write가 읽기 도중에 끼어들었다: {events}"
            )


def test_read_budget_fits_inside_manager_timeout():
    worst = (
        config.S7_READ_BUDGET_S
        + config.S7_RECV_TIMEOUT_MS / 1000.0
        + config.S7_MIN_REQUEST_INTERVAL
    )
    assert worst < config.READ_TIMEOUT


class TestReadBudget:
    async def test_unresponsive_plc_stays_under_budget(self, adapter):
        recv_s = config.S7_RECV_TIMEOUT_MS / 1000.0

        def hang_then_fail(db, offset, size):
            time.sleep(recv_s)
            raise IOError("timeout")

        adapter._plc.db_read.side_effect = hang_then_fail
        t0 = time.monotonic()
        with pytest.raises((TimeoutError, IOError)):
            await adapter.read()
        elapsed = time.monotonic() - t0
        assert elapsed < config.READ_TIMEOUT
        assert elapsed < 2.6
        assert adapter._plc.db_read.call_count < 10
        adapter._plc.get_cpu_state.assert_not_called()

    async def test_budget_cuts_channel_attempts(self, adapter, monkeypatch):
        monkeypatch.setattr(config, "S7_READ_BUDGET_S", 0.25)
        monkeypatch.setattr(config, "S7_RECV_TIMEOUT_MS", 200)

        def hang_then_fail(db, offset, size):
            time.sleep(0.2)
            raise IOError("timeout")

        adapter._plc.db_read.side_effect = hang_then_fail
        with pytest.raises((TimeoutError, IOError)):
            await adapter.read()
        # 5채널 × 2시도 = 10을 채우지 못한다
        assert adapter._plc.db_read.call_count < 10
        assert adapter._plc.db_read.call_count >= 1

    async def test_healthy_read_unaffected(self, adapter):
        t0 = time.monotonic()
        reading = await adapter.read()
        assert time.monotonic() - t0 < 0.3
        assert adapter._plc.db_read.call_count == 5
        assert reading.bt == 0.0
        adapter._plc.get_cpu_state.assert_not_called()

    async def test_retry_preserved_when_budget_allows(self, adapter):
        calls = {"n": 0}

        def fail_once(db, offset, size):
            calls["n"] += 1
            if calls["n"] == 1:
                raise IOError("transient")
            return bytearray(size)

        adapter._plc.db_read.side_effect = fail_once
        reading = await adapter.read()
        assert reading.bt == 0.0
        # 첫 채널 실패+재시도, 나머지 4채널 1회
        assert adapter._plc.db_read.call_count == 6


class TestIoLockTimeout:
    async def test_read_times_out_when_lock_held(self, adapter):
        started = threading.Event()

        def hold() -> None:
            adapter._io_lock.acquire()
            started.set()
            time.sleep(1.5)
            adapter._io_lock.release()

        t = threading.Thread(target=hold, daemon=True)
        t.start()
        started.wait(timeout=1.0)
        t0 = time.monotonic()
        with pytest.raises(TimeoutError, match="I/O lock"):
            await adapter.read()
        assert time.monotonic() - t0 < 0.7
        t.join()

    async def test_disconnect_unblocks_while_db_read_stuck(self, adapter):
        started = threading.Event()

        def slow_read(db, offset, size):
            started.set()
            time.sleep(2.0)
            return bytearray(size)

        adapter._plc.db_read.side_effect = slow_read
        read_task = asyncio.create_task(adapter.read())
        while not started.is_set():
            await asyncio.sleep(0.01)

        t0 = time.monotonic()
        await adapter.disconnect()
        assert time.monotonic() - t0 < 3.2
        assert adapter._plc is None

        t1 = time.monotonic()
        with pytest.raises(ConnectionError):
            await adapter.read()
        assert time.monotonic() - t1 < 0.2
        with pytest.raises(ConnectionError):
            await read_task

    async def test_stuck_read_does_not_block_reconnect(self, adapter, monkeypatch):
        """세대 토큰: 좀비 read가 남은 채널을 붙잡지 않아 connect/read가 바로 진행된다."""
        _, client = _install_snap7(monkeypatch)

        started = threading.Event()

        def stuck(db, offset, size):
            started.set()
            time.sleep(0.8)
            return bytearray(size)

        adapter._plc.db_read.side_effect = stuck
        zombie = asyncio.create_task(adapter.read())
        while not started.is_set():
            await asyncio.sleep(0.01)

        t0 = time.monotonic()
        await adapter.disconnect()
        await adapter.connect()
        client.db_read.side_effect = lambda db, offset, size: bytearray(size)
        reading = await adapter.read()
        elapsed = time.monotonic() - t0
        assert elapsed < 1.8
        assert reading.bt == 0.0
        with pytest.raises(ConnectionError, match="세션"):
            await zombie


class TestPlcRebind:
    async def test_in_flight_read_stays_on_snapshotted_plc(self, adapter):
        old = adapter._plc
        new = MagicMock()
        new.get_connected.return_value = True
        swapped = {"done": False}

        def tracking_read(db, offset, size):
            if not swapped["done"]:
                adapter._plc = new
                swapped["done"] = True
            return bytearray(size)

        old.db_read.side_effect = tracking_read
        await adapter.read()
        new.db_read.assert_not_called()
        assert old.db_read.call_count == 5

    async def test_connect_fails_if_previous_session_holds_lock(self, adapter, monkeypatch):
        _install_snap7(monkeypatch)
        monkeypatch.setattr(config, "S7_TEARDOWN_LOCK_TIMEOUT_S", 0.1)
        adapter._io_lock.acquire()
        try:
            with pytest.raises(ConnectionError, match="이전 S7 세션"):
                await adapter.connect()
        finally:
            adapter._io_lock.release()

    async def test_connect_aborts_when_session_bumped(self, adapter, monkeypatch):
        _, client = _install_snap7(monkeypatch)
        entered = threading.Event()
        release = threading.Event()

        def fake_connect(*_a, **_k):
            entered.set()
            release.wait(timeout=1.0)

        client.connect.side_effect = fake_connect

        async def bump() -> None:
            while not entered.is_set():
                await asyncio.sleep(0.01)
            adapter._session += 1
            release.set()

        bumper = asyncio.create_task(bump())
        with pytest.raises(ConnectionError, match="취소"):
            await adapter.connect()
        await bumper
        client.destroy.assert_called()

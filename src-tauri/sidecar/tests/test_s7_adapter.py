"""Behavioral tests for S7Adapter write path.

snap7 클라이언트만 MagicMock으로 대체하고 어댑터 로직(클램프, 스케일 역변환,
INT/REAL 인코딩, 락 직렬화)은 실제로 돌린다. 하드웨어 불필요.
"""

import asyncio
import socket
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

import config
from snap7.util.getters import get_int, get_real
from snap7.util.setters import set_int

from adapters.s7 import S7Adapter, _probe_tcp  # autouse 패치 이전의 원본을 잡아둔다
from roaster_registry import ROASTER_REGISTRY


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


@pytest.fixture(autouse=True)
def _no_tcp_probe(monkeypatch):
    """connect()의 TCP 프로브는 실소켓이다 — 단위 테스트에서는 항상 통과시킨다."""
    monkeypatch.setattr("adapters.s7._probe_tcp", lambda *a, **k: None)


@pytest.fixture
def adapter():
    a = S7Adapter(host="127.0.0.1", channels=GIESEN_CHANNELS, write_map=GIESEN_WRITE_MAP)
    plc = MagicMock()
    plc.get_connected.return_value = True
    plc.get_cpu_state.return_value = "S7CpuStatusRun"
    plc.db_read.return_value = _int_bytes(0)
    a._plc = plc
    a._min_interval = 0.0  # 스로틀은 이 테스트의 대상이 아님
    # connect()가 채우는 채널 캐시 — 없으면 read()가 db_read를 한 번도 부르지 않는다
    a._bt_ch, a._et_ch, a._hp_ch, a._fc_ch, a._drum_ch = GIESEN_CHANNELS
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

    @pytest.mark.parametrize("requested, logical", [(0, 40), (40, 40), (45, 45), (55, 55), (100, 55)])
    async def test_w45a_w60a_drum_writes_int_hz_without_changing_heater(self, adapter, requested, logical):
        from manager import RoasterManager

        defaults = ROASTER_REGISTRY["giesen_w45a_w60a"]["default_params"]
        adapter._write_map = defaults["write_map"]
        manager = RoasterManager()
        manager._adapter = adapter
        manager._protocol = "s7"
        manager._connected = True
        manager._merged_params = defaults
        await manager.control(heater=22)
        assert get_int(_written(adapter._plc)[2], 0) == 23
        adapter._plc.db_write.reset_mock()

        assert await manager.control(drum=requested) == {"drum": logical}
        assert manager.last_applied() == {"heater": 22, "drum": logical}
        adapter._plc.db_write.assert_called_once()
        db, offset, payload = _written(adapter._plc)
        assert (db, offset, len(payload), get_int(payload, 0)) == (2, 18, 2, logical)

    async def test_raises_when_plc_none(self, adapter):
        plc = adapter._plc
        adapter._plc = None
        with pytest.raises(ConnectionError, match="연결되지 않음"):
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
    @pytest.mark.parametrize("key", [key for key in ROASTER_REGISTRY if key.startswith("giesen_")])
    @pytest.mark.parametrize("requested", [0, 1, 10, 22, 100, -10, 110])
    async def test_giesen_logical_command_and_plc_encoding(self, adapter, key, requested):
        from manager import RoasterManager

        defaults = ROASTER_REGISTRY[key]["default_params"]
        logical = max(0, min(requested, 10 if key == "giesen_wxa_coarse" else 100))
        raw = logical + (0 if key == "giesen_w6a_pro" else 1)
        adapter._write_map = defaults["write_map"]
        adapter._channels = defaults["channels"]
        manager = RoasterManager()
        manager._adapter = adapter
        manager._protocol = "s7"
        manager._connected = True
        manager._merged_params = defaults
        assert await manager.control(heater=requested) == {"heater": logical}
        assert manager.last_applied() == {"heater": logical}
        assert manager.write_limits()["heater"]["min"] == 0
        db, offset, payload = _written(adapter._plc)
        cell = (1001, 42) if key == "giesen_w6a_pro" else (2, 14)
        assert (db, offset, get_int(payload, 0)) == (*cell, raw)
        assert adapter._plc.db_write.call_count == 1
        adapter._plc.db_read.return_value = _int_bytes(72)
        assert await adapter.read_raw_channel("heater") == 72.0
        feedback = next(ch for ch in defaults["channels"] if ch["role"] == "heater")
        assert adapter._plc.db_read.call_args.args[:2] == (feedback["db"], feedback["offset"])

    @pytest.mark.parametrize("value_offset", [True, "1", None, float("nan"), float("inf")])
    async def test_rejects_invalid_value_offset(self, adapter, value_offset):
        adapter._write_map = {"heater": {**GIESEN_WRITE_MAP["heater"], "value_offset": value_offset}}
        with pytest.raises(ValueError, match="value_offset"):
            await adapter.control(heater=0)
        adapter._plc.db_write.assert_not_called()

    async def test_offset_is_added_after_div_scaling(self, adapter):
        adapter._write_map = {"heater": {**GIESEN_WRITE_MAP["heater"], "div": 1, "value_offset": 1}}
        await adapter.control(heater=10)
        assert get_int(_written(adapter._plc)[2], 0) == 101

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
        adapter._plc.db_read.return_value = _int_bytes(72)
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


# ---------------------------------------------------------------------------
# TestReadBudget (#209) — 읽기 전체를 벽시계 예산으로 묶는다
# ---------------------------------------------------------------------------

def _recv_s() -> float:
    return config.S7_RECV_TIMEOUT_MS / 1000.0


@pytest.fixture
def fast_s7_timing(monkeypatch):
    """실제 상수의 1/5로 축소 — 벽시계 예산 로직은 비율만 유지되면 동일하게 검증된다.

    상수 간 부등식 자체는 TestBudgetRelation이 실제 값으로 검증한다.
    """
    monkeypatch.setattr(config, "S7_RECV_TIMEOUT_MS", 100)
    monkeypatch.setattr(config, "S7_READ_BUDGET_S", 0.4)
    monkeypatch.setattr(config, "S7_IO_LOCK_TIMEOUT_S", 0.1)
    monkeypatch.setattr(config, "S7_TEARDOWN_LOCK_TIMEOUT_S", 0.6)
    monkeypatch.setattr(config, "READ_TIMEOUT", 0.6)


def _unresponsive_read(delay: float | None = None):
    """무응답 PLC: RecvTimeout만큼 버틴 뒤 실패한다."""

    def _read(db, offset, size):
        time.sleep(_recv_s() if delay is None else delay)
        raise RuntimeError("RecvTimeout")

    return _read


def _slow_ok_read(delay: float | None = None):
    """느리지만 성공하는 PLC — 채널 수가 예산을 잡아먹는 경우."""

    def _read(db, offset, size):
        time.sleep(_recv_s() if delay is None else delay)
        return _int_bytes(0) if size == 2 else bytearray(4)

    return _read


@pytest.mark.usefixtures("fast_s7_timing")
class TestReadBudget:
    async def test_unresponsive_plc_returns_within_budget(self, adapter):
        """manager의 READ_TIMEOUT(3.0) 만료 전에 스레드가 스스로 락을 놓아야 한다."""
        adapter._plc.db_read.side_effect = _unresponsive_read()

        t0 = time.monotonic()
        with pytest.raises(Exception):
            await adapter.read()
        elapsed = time.monotonic() - t0

        assert elapsed < config.READ_TIMEOUT, f"예산 초과: {elapsed:.2f}s"
        assert elapsed < config.S7_READ_BUDGET_S + config.S7_MIN_REQUEST_INTERVAL + _recv_s()
        # 락이 반납됐어야 다음 요청이 대기 없이 들어온다 (좀비 없음)
        assert adapter._io_lock.acquire(timeout=0.0) is True
        adapter._io_lock.release()

    async def test_budget_cuts_channel_attempts(self, adapter):
        """5채널 × RecvTimeout이 예산을 넘으면 남은 채널 시도를 자른다."""
        adapter._plc.db_read.side_effect = _slow_ok_read()

        t0 = time.monotonic()
        with pytest.raises(Exception):
            await adapter.read()
        elapsed = time.monotonic() - t0

        assert elapsed < config.READ_TIMEOUT
        # 5채널 × retry 포함 2회 = 10회가 무제한일 때의 값
        assert adapter._plc.db_read.call_count < 10

    async def test_bt_is_always_attempted(self, adapter):
        """예산이 빠듯해도 첫 채널(BT)은 최소 1회 시도된다."""
        adapter._plc.db_read.side_effect = _slow_ok_read()
        with pytest.raises(Exception):
            await adapter.read()
        first = adapter._plc.db_read.call_args_list[0].args
        assert first[:2] == (3, 116)  # BT 채널

    async def test_retry_preserved_when_budget_allows(self, adapter):
        """예산에 여유가 있으면 Artisan 기준 retry 1회는 그대로 유지한다."""
        adapter._plc.db_read.side_effect = RuntimeError("boom")  # 즉시 실패
        with pytest.raises(RuntimeError):
            await adapter.read()
        assert adapter._plc.db_read.call_count == 2  # 최초 + retry 1회

    async def test_normal_read_unaffected(self, adapter):
        adapter._plc.db_read.side_effect = _slow_ok_read(0.0)
        t0 = time.monotonic()
        reading = await adapter.read()
        elapsed = time.monotonic() - t0
        assert elapsed < 0.3
        assert adapter._plc.db_read.call_count == 5
        assert reading.bt == 0.0

    async def test_read_path_never_calls_get_cpu_state(self, adapter):
        """get_cpu_state()는 네트워크 왕복 — 읽기 예산의 20%를 낭비하던 주범."""
        adapter._plc.db_read.side_effect = _slow_ok_read(0.0)
        await adapter.read()
        await adapter.read_raw_channel("heater")
        adapter._plc.get_cpu_state.assert_not_called()

class TestBudgetRelation:
    def test_budget_relation_holds(self):
        """어느 상수를 손대든 이 부등식이 깨지면 좀비 스레드가 돌아온다. 실제 config 값으로 검증."""
        worst = (
            config.S7_READ_BUDGET_S
            + config.S7_MIN_REQUEST_INTERVAL
            + config.S7_RECV_TIMEOUT_MS / 1000.0
        )
        assert worst < config.READ_TIMEOUT
        assert config.S7_TEARDOWN_LOCK_TIMEOUT_S > worst - config.S7_IO_LOCK_TIMEOUT_S


# ---------------------------------------------------------------------------
# TestIoLockTimeout (#209) — 락 대기가 무한하지 않다
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("fast_s7_timing")
class TestIoLockTimeout:
    async def test_read_gives_up_on_held_lock(self, adapter):
        """다른 스레드가 락을 오래 쥐면 읽기는 기다리지 않고 실패로 승격한다."""
        release = threading.Event()

        def hold():
            with adapter._io_lock:
                release.wait(0.5)

        holder = threading.Thread(target=hold)
        holder.start()
        try:
            time.sleep(0.05)  # 락이 확실히 잡히도록
            t0 = time.monotonic()
            with pytest.raises(TimeoutError):
                await adapter.read()
            assert time.monotonic() - t0 < config.S7_IO_LOCK_TIMEOUT_S + 0.2
        finally:
            release.set()
            holder.join()

    async def test_disconnect_not_blocked_behind_slow_read(self, adapter):
        """느린 read가 락을 쥐고 있어도 disconnect가 백오프 안에 끝나야 한다."""
        adapter._plc.db_read.side_effect = _slow_ok_read(0.5)
        plc = adapter._plc

        read_task = asyncio.create_task(adapter.read())
        await asyncio.sleep(0.05)

        t0 = time.monotonic()
        await asyncio.wait_for(adapter.disconnect(), timeout=2.0)
        assert time.monotonic() - t0 < config.S7_TEARDOWN_LOCK_TIMEOUT_S + 0.5
        assert adapter._plc is None

        with pytest.raises(Exception):
            await read_task
        plc.destroy.assert_called_once()

    async def test_read_after_disconnect_fails_immediately(self, adapter):
        await adapter.disconnect()
        t0 = time.monotonic()
        with pytest.raises(ConnectionError):
            await adapter.read()
        assert time.monotonic() - t0 < 0.2


# ---------------------------------------------------------------------------
# TestPlcRebind (#209 + #208) — 바인딩은 락 안에서, 취소된 세션은 버린다
# ---------------------------------------------------------------------------

class TestPlcRebind:
    async def test_read_never_crosses_clients(self, adapter):
        """read 도중 _plc가 교체돼도 그 read는 시작한 클라이언트만 본다."""
        old_plc = adapter._plc
        new_plc = MagicMock()
        new_plc.get_connected.return_value = True
        new_plc.db_read.return_value = _int_bytes(0)

        calls: list[int] = []

        def swap_on_first_read(db, offset, size):
            calls.append(db)
            if len(calls) == 1:
                adapter._plc = new_plc  # 재연결이 끼어든 상황
            return _int_bytes(0) if size == 2 else bytearray(4)

        old_plc.db_read.side_effect = swap_on_first_read

        await adapter.read()

        assert old_plc.db_read.call_count == 5
        new_plc.db_read.assert_not_called()

    async def test_connect_binds_under_lock(self, adapter, monkeypatch):
        """이전 세션이 락을 놓지 않으면 연결하지 않는다 — 무락 재바인딩 금지."""
        monkeypatch.setattr(config, "S7_TEARDOWN_LOCK_TIMEOUT_S", 0.1)
        client = MagicMock()
        release = threading.Event()

        def hold():
            with adapter._io_lock:
                release.wait(1.0)

        holder = threading.Thread(target=hold)
        holder.start()
        try:
            time.sleep(0.05)
            with patch("snap7.client.Client", return_value=client):
                with pytest.raises(ConnectionError, match="이전 S7 세션"):
                    await adapter.connect()
            client.destroy.assert_called_once()
        finally:
            release.set()
            holder.join()

    async def test_late_connect_after_session_bump_is_discarded(self, adapter):
        """취소된 연결 시도가 뒤늦게 완료돼도 바인딩하지 않고 정리한다 (#208)."""
        adapter._plc = None
        client = MagicMock()

        def bump_session(*args, **kwargs):
            adapter._session += 1  # 핸드셰이크 도중 disconnect 상당

        client.connect.side_effect = bump_session

        with patch("snap7.client.Client", return_value=client):
            with pytest.raises(ConnectionError, match="취소"):
                await adapter.connect()

        assert adapter._plc is None
        client.disconnect.assert_called_once()
        client.destroy.assert_called_once()

    async def test_disconnect_bumps_session(self, adapter):
        before = adapter._session
        await adapter.disconnect()
        assert adapter._session == before + 1


class TestConnectProbe:
    async def test_unreachable_host_fails_fast_without_snap7(self, adapter, monkeypatch):
        """프로브가 막히면 snap7 클라이언트를 만들지도 않고 즉시 실패한다 (Artisan isOpen)."""
        adapter._plc = None
        monkeypatch.setattr(config, "S7_PROBE_TIMEOUT_S", 0.05)
        monkeypatch.setattr(
            "adapters.s7._probe_tcp",
            lambda *a, **k: (_ for _ in ()).throw(socket.timeout("timed out")),
        )
        with patch("snap7.client.Client") as client_cls:
            t0 = time.monotonic()
            with pytest.raises(OSError, match="timed out"):
                await adapter.connect()
            assert time.monotonic() - t0 < 1.0
            client_cls.assert_not_called()
        assert adapter._plc is None

    def test_probe_uses_host_port_and_timeout(self, monkeypatch):
        seen = {}

        def fake_create_connection(addr, timeout):
            seen["addr"], seen["timeout"] = addr, timeout

            class _Sock:
                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

            return _Sock()

        monkeypatch.setattr(socket, "create_connection", fake_create_connection)
        _probe_tcp("172.30.30.90", 102, 0.7)
        assert seen == {"addr": ("172.30.30.90", 102), "timeout": 0.7}


def test_feedback_keeps_scaled_hundredths(adapter):
    channel = {"role": "drum", "db": 2, "offset": 18, "type": 0, "div": 2, "unit": "Hz"}
    adapter._plc.db_read.return_value = _int_bytes(3125)
    assert adapter._read_channel_sync(channel, adapter._plc) == 31.25

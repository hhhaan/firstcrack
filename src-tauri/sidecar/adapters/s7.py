import asyncio
import math
import threading
import time
import logging
from typing import Any

import config
from adapters.base import Reading
from protocol_trace import TRACE

_log = logging.getLogger(__name__)


def _destroy_client(client: Any) -> None:
    if client is None:
        return
    try:
        client.disconnect()
    except Exception:
        pass
    try:
        client.destroy()
    except Exception:
        pass


class S7Adapter:
    """
    Siemens S7 PLC 어댑터 (Giesen, Probat S7 모델).
    python-snap7 직접 사용 (extern/s7port.py는 Qt에 깊게 결합돼 있어 사용 불가).

    channels: roaster_registry의 "channels" 배열 (읽기 전용)
      [{"role": "BT"|"ET"|"heater"|"fan", "db": N, "offset": N, "area": 6, "type": 0|1, "div": 0|1|2}, ...]
    type: 0=int (2 bytes), 1=float (4 bytes)
    area: 6=DB (DataBlock) — Giesen/Probat 모두 여기
    div:  0=raw, 1=÷10, 2=÷100

    write_map: roaster_registry의 "write_map" (쓰기 전용, role → spec + min/max)
      읽기 채널과 셀이 다르다. Giesen은 heater 피드백 DB2.48 / 세트포인트 DB2.14.
      write_map에 없는 role은 쓰지 않는다(= 해당 머신 쓰기 미지원).

    snap7은 동기 API → run_in_executor로 이벤트 루프 블로킹 방지.
    read_retries=1, min_request_interval=0.04s (40ms) — artisan s7port.py 기준.
    """

    # INT16 인코딩 한계 — 스케일링 후 이 범위를 넘으면 랩어라운드로 엉뚱한 값이 써진다.
    _INT16_MIN = -32768
    _INT16_MAX = 32767

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 102,
        rack: int = 0,
        slot: int = 0,
        channels: list[dict[str, Any]] | None = None,
        write_map: dict[str, dict[str, Any]] | None = None,
        **_: Any,
    ) -> None:
        self._host = host
        self._port = port
        self._rack = rack
        self._slot = slot
        self._channels = channels or []
        self._write_map = write_map or {}
        self._plc: Any = None
        # snap7 클라이언트는 스레드 세이프하지 않다. read()의 asyncio.wait_for 타임아웃은
        # executor 스레드를 중단시키지 못하므로(manager H7), 타임아웃 직후 들어온 쓰기가
        # 아직 살아있는 읽기와 같은 클라이언트를 동시에 건드릴 수 있다 → 스레드 락으로 직렬화.
        self._io_lock = threading.Lock()
        # disconnect마다 +1. 락을 잡은 뒤늦은 read/connect는 세대 불일치로 즉시 중단하고
        # 락을 놓는다 — 좀비 스레드가 재연결을 수십 초 막는 것을 막는다.
        self._session: int = 0
        self._read_retries: int = 1
        self._min_interval: float = config.S7_MIN_REQUEST_INTERVAL
        self._last_request_ts: float = 0.0
        # 채널 캐시 — connect() 시 한 번만 계산
        self._bt_ch: dict[str, Any] | None = None
        self._et_ch: dict[str, Any] | None = None
        self._hp_ch: dict[str, Any] | None = None
        self._fc_ch: dict[str, Any] | None = None
        self._drum_ch: dict[str, Any] | None = None

    def _cache_channels(self) -> None:
        self._bt_ch = next((c for c in self._channels if c.get("role") == "BT"), None)
        self._et_ch = next((c for c in self._channels if c.get("role") == "ET"), None)
        self._hp_ch = next((c for c in self._channels if c.get("role") == "heater"), None)
        self._fc_ch = next((c for c in self._channels if c.get("role") == "fan"), None)
        self._drum_ch = next((c for c in self._channels if c.get("role") == "drum"), None)

    def _clear_channels(self) -> None:
        self._bt_ch = self._et_ch = self._hp_ch = self._fc_ch = self._drum_ch = None

    def _ensure_session(self, session: int) -> None:
        if session != self._session:
            raise ConnectionError("S7 세션이 교체됨")

    def _acquire_io(self, timeout: float) -> None:
        if not self._io_lock.acquire(timeout=timeout):
            raise TimeoutError("S7 I/O lock timeout")

    async def connect(self) -> None:
        import snap7  # type: ignore[import]

        if not self._channels:
            raise ValueError("channels가 비어 있음. roaster_registry 확인 필요.")

        session = self._session

        def _connect() -> None:
            client = snap7.client.Client()
            try:
                # RecvTimeout 기본 3s. PLC 무응답 시 채널×retry 합이 READ_TIMEOUT을
                # 넘지 않도록 하향 — deadline이 상한을 고정하고 이 값은 1회 상한.
                client.set_param(
                    snap7.type.Parameter.RecvTimeout, config.S7_RECV_TIMEOUT_MS
                )
                client.connect(self._host, self._rack, self._slot, self._port)
                time.sleep(0.2)  # Artisan: wait after connect for slow PLCs
            except Exception:
                _destroy_client(client)
                raise

            if not self._io_lock.acquire(timeout=config.S7_TEARDOWN_LOCK_TIMEOUT_S):
                _destroy_client(client)
                raise ConnectionError("이전 S7 세션이 정리되지 않아 연결할 수 없습니다.")
            try:
                if session != self._session:
                    _destroy_client(client)
                    raise ConnectionError("연결 시도가 취소되었습니다.")
                self._plc = client
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _connect)

        # connected는 get_cpu_state() 네트워크 왕복을 포함 → 이벤트 루프 밖에서 평가 (H5)
        if not await loop.run_in_executor(None, lambda: self.connected):
            raise ConnectionError(
                f"S7 연결 실패: {self._host}:{self._port} (rack={self._rack}, slot={self._slot})"
            )
        self._cache_channels()
        _log.info("S7Adapter connected: %s:%d", self._host, self._port)

    async def disconnect(self) -> None:
        # 락 밖에서 세대를 올리고 핸들을 끊는다. 이후 신규 I/O는 즉시 실패하고,
        # 락을 쥔 좀비 read는 다음 채널/재시도에서 세션 불일치를 보고 락을 놓는다.
        self._session += 1
        plc = self._plc
        self._plc = None
        self._clear_channels()

        def _disconnect() -> None:
            if plc is None:
                return
            if not self._io_lock.acquire(timeout=config.S7_TEARDOWN_LOCK_TIMEOUT_S):
                # 사용 중 destroy()는 snap7 크래시 위험. 참조만 포기하고 GC에 맡긴다.
                _log.warning("S7 disconnect: I/O lock timeout — 이전 클라이언트 참조 포기")
                return
            try:
                _destroy_client(plc)
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _disconnect)

    def _throttle(self) -> None:
        """요청 간 최소 간격(40ms) 보장. 스레드에서 호출."""
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_ts = time.monotonic()

    def _read_channel_sync(
        self,
        ch: dict[str, Any],
        plc: Any,
        deadline: float,
        session: int,
        *,
        force_first: bool = False,
    ) -> float:
        """스레드에서 실행. snap7 db_read → float 변환. retry 포함.

        plc는 락 획득 직후 스냅샷 — 시도 사이 disconnect가 self._plc를 비워도
        AttributeError가 나지 않고, 구 클라이언트에서만 읽는다.
        """
        from snap7.util.getters import get_real, get_int  # type: ignore[import]

        db: int = ch["db"]
        offset: int = ch["offset"]
        ch_type: int = ch.get("type", 0)  # 0=int(2B), 1=float(4B)
        div: int = ch.get("div", 0)
        size = 4 if ch_type == 1 else 2
        per_attempt = self._min_interval + config.S7_RECV_TIMEOUT_MS / 1000.0

        last_exc: Exception = RuntimeError("S7 읽기 실패")
        for attempt in range(self._read_retries + 1):
            self._ensure_session(session)
            over_budget = time.monotonic() + per_attempt > deadline
            if over_budget and not (force_first and attempt == 0):
                if attempt == 0:
                    raise TimeoutError("S7 읽기 예산 초과")
                raise last_exc
            self._throttle()
            try:
                role = ch.get("role", "?")
                TRACE.record("tx", "s7", f"db_read db={db} offset={offset} size={size} role={role}")
                ba: bytearray = plc.db_read(db, offset, size)
                TRACE.record("rx", "s7", f"db_read db={db} offset={offset} role={role}", bytes(ba))
                if len(ba) != size:
                    raise IOError(f"db_read 응답 크기 불일치: {len(ba)} != {size}")
                value = float(get_real(ba, 0) if ch_type == 1 else get_int(ba, 0))
                if div == 1:
                    value /= 10.0
                elif div == 2:
                    value /= 100.0
                value = round(value, 1)
                TRACE.record(
                    "info", "s7",
                    f"decoded role={role} type={'REAL' if ch_type == 1 else 'INT'} div={div}",
                    value,
                )
                self._ensure_session(session)
                return value
            except ConnectionError:
                raise
            except TimeoutError:
                raise
            except Exception as exc:
                last_exc = exc
                TRACE.record("err", "s7", f"db={db} offset={offset} attempt={attempt + 1}: {exc}")
                _log.warning("S7 읽기 실패 (attempt %d/%d): db=%d offset=%d — %s",
                             attempt + 1, self._read_retries + 1, db, offset, exc)
        raise last_exc

    async def read(self) -> Reading:
        # 여기서는 핸들 유무만 확인한다. 실제 연결 검사(connected)는 get_cpu_state()
        # 네트워크 왕복이라 이벤트 루프에서 하면 PLC 다운 시 aiohttp 전체가 멈춘다 (H5).
        if self._plc is None:
            raise ConnectionError("S7 PLC가 연결되지 않음")

        session = self._session
        deadline = time.monotonic() + config.S7_READ_BUDGET_S

        def _read_all() -> tuple[float, float, float, float, float]:
            self._acquire_io(config.S7_IO_LOCK_TIMEOUT_S)
            try:
                self._ensure_session(session)
                plc = self._plc
                # get_connected()는 로컬 필드(무비용). 거짓 양성 가능 — 진짜 판정은
                # db_read 실패. get_cpu_state()는 왕복이라 읽기 경로에서 쓰지 않는다.
                if plc is None or not plc.get_connected():
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                bt_ch, et_ch = self._bt_ch, self._et_ch
                hp_ch, fc_ch, drum_ch = self._hp_ch, self._fc_ch, self._drum_ch
                bt = self._read_channel_sync(
                    bt_ch, plc, deadline, session, force_first=True
                ) if bt_ch else -1.0
                et = self._read_channel_sync(et_ch, plc, deadline, session) if et_ch else -1.0
                hp = self._read_channel_sync(hp_ch, plc, deadline, session) if hp_ch else 0.0
                fc = self._read_channel_sync(fc_ch, plc, deadline, session) if fc_ch else 0.0
                drum = self._read_channel_sync(
                    drum_ch, plc, deadline, session
                ) if drum_ch else 0.0
                return bt, et, hp, fc, drum
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        bt, et, hp, fc, drum = await loop.run_in_executor(None, _read_all)
        return Reading(bt=bt, et=et, heater=hp, fan=fc, drum=drum, timestamp=time.monotonic())

    async def read_raw_channel(self, role: str) -> float | None:
        """읽기 채널 하나만 조회. heater 피드백(Giesen DB2.48)처럼 Reading에 담기지 않는
        값을 PID engage/release 시점에 확인하는 용도. 미연결/미매핑이면 None."""
        ch = next((c for c in self._channels if c.get("role") == role), None)
        if ch is None or self._plc is None:
            return None

        session = self._session
        deadline = time.monotonic() + config.S7_READ_BUDGET_S

        def _read_one() -> float:
            self._acquire_io(config.S7_IO_LOCK_TIMEOUT_S)
            try:
                self._ensure_session(session)
                plc = self._plc
                if plc is None:
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                return self._read_channel_sync(ch, plc, deadline, session, force_first=True)
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _read_one)

    def _write_channel_sync(
        self, role: str, spec: dict[str, Any], value: float, plc: Any
    ) -> int | float:
        """스레드에서 실행. clamp → div 역스케일 → INT/REAL 인코딩 → db_write.

        읽기의 역순이다(읽기는 ÷10/÷100, 쓰기는 ×10/×100).
        반환값은 PLC에 실제로 쓴 raw 값.
        """
        from snap7.util.setters import set_int, set_real  # type: ignore[import]

        if not math.isfinite(value):
            raise ValueError(f"쓰기 값이 유한하지 않음: role={role} value={value}")

        db: int = spec["db"]
        offset: int = spec["offset"]
        ch_type: int = spec.get("type", 0)
        div: int = spec.get("div", 0)

        lo = spec.get("min")
        hi = spec.get("max")
        if lo is not None:
            value = max(float(lo), value)
        if hi is not None:
            value = min(float(hi), value)

        scaled = value * (10.0 if div == 1 else 100.0 if div == 2 else 1.0)

        raw: int | float
        if ch_type == 1:
            raw = float(scaled)
            ba = bytearray(4)
            set_real(ba, 0, raw)
        else:
            raw = int(round(scaled))
            if not (self._INT16_MIN <= raw <= self._INT16_MAX):
                raise ValueError(f"INT16 범위 초과: role={role} raw={raw}")
            ba = bytearray(2)
            set_int(ba, 0, raw)

        self._throttle()
        TRACE.record(
            "tx", "s7",
            f"db_write db={db} offset={offset} role={role} value={value} raw={raw}",
            bytes(ba),
        )
        plc.db_write(db, offset, ba)
        return raw

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        """write_map에 매핑된 role만 PLC에 쓴다.

        미연결이거나 write_map에 없는 role은 조용히 무시한다 — 어댑터는 관대하게,
        연결/권한 검사는 상위(manager, /control 핸들러)가 담당한다.
        """
        requested = {"heater": heater, "fan": fan, "drum": drum}
        targets = [
            (role, self._write_map[role], float(value))
            for role, value in requested.items()
            if value is not None and role in self._write_map
        ]
        if not targets or self._plc is None:
            return

        session = self._session

        def _write_all() -> None:
            self._acquire_io(config.S7_IO_LOCK_TIMEOUT_S)
            try:
                if session != self._session:
                    return
                plc = self._plc
                if plc is None:
                    return
                for role, spec, value in targets:
                    if session != self._session:
                        return
                    self._write_channel_sync(role, spec, value, plc)
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _write_all)

    @property
    def write_map(self) -> dict[str, dict[str, Any]]:
        """쓰기 가능한 role → spec. 빈 dict면 이 머신은 쓰기 미지원."""
        return self._write_map

    @property
    def connected(self) -> bool:
        # get_connected() can return True after peer-terminated connections (snap7 bug);
        # CPU state check is the reliable signal — from Artisan s7port.py
        # connect 검증·/status 전용. 읽기 핫패스는 db_read 실패로 판정한다.
        plc = self._plc
        try:
            return (plc is not None and
                    plc.get_connected() and
                    str(plc.get_cpu_state()) == "S7CpuStatusRun")
        except Exception:
            return False

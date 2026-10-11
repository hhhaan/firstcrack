import asyncio
import math
import socket
import threading
import time
import logging
from typing import Any

import config
from adapters.base import Reading
from protocol_trace import TRACE

_log = logging.getLogger(__name__)


def _client_alive(plc: Any) -> bool:
    """클라이언트가 살아있는 PLC에 붙어 있는지 확인 (네트워크 왕복 포함).

    get_connected()는 peer가 끊은 뒤에도 True를 돌려줄 수 있어(snap7 버그)
    CPU 상태 조회가 신뢰할 수 있는 신호다 — Artisan s7port.py 기준.
    비싸므로 connect 검증과 /status에서만 쓴다. 읽기 경로에서는 쓰지 않는다.
    """
    try:
        return (
            plc is not None
            and plc.get_connected()
            and str(plc.get_cpu_state()) == "S7CpuStatusRun"
        )
    except Exception:
        return False


def _probe_tcp(host: str, port: int, timeout: float) -> None:
    """snap7 전 TCP 프로브 — Artisan s7port.connect()의 isOpen()과 같은 자리.

    도달 불가 IP에서 Cli_ConnectTo는 커널 SYN 타임아웃(macOS 75s)까지 블로킹되고
    PingTimeout(750ms)은 connect에 적용되지 않는다(실측). 소켓 예외는 그대로 올린다 —
    manager._format_connection_error가 refused/timed out/unreachable을 분류한다.
    """
    with socket.create_connection((host, port), timeout=timeout):
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
        # 세션 에폭. disconnect마다 +1 — snap7.connect()는 중단 불가라 취소된 연결
        # 시도가 executor 스레드에서 뒤늦게 완료될 수 있다. 바인딩 직전 에폭이
        # 다르면 그 클라이언트는 유령이므로 destroy하고 버린다.
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

    async def connect(self) -> None:
        import snap7  # type: ignore[import]

        if not self._channels:
            raise ValueError("channels가 비어 있음. roaster_registry 확인 필요.")

        session = self._session

        def _connect() -> Any:
            _probe_tcp(self._host, self._port, config.S7_PROBE_TIMEOUT_S)
            client = snap7.client.Client()
            # RecvTimeout 기본 3s → config 값. PLC가 응답 없이 hang하면 manager의
            # wait_for(3s)는 만료돼도 snap7 동기 호출이 잡은 executor 스레드는
            # 남는다 — 폴링마다 쌓이지 않게 블로킹 상한을 짧게 제한.
            client.set_param(snap7.type.Parameter.RecvTimeout, config.S7_RECV_TIMEOUT_MS)
            client.connect(self._host, self._rack, self._slot, self._port)
            time.sleep(0.2)  # Artisan: wait after connect for slow PLCs
            # 바인딩은 반드시 락 안에서 — 무락 재바인딩이면 락을 기다리던 구 세션
            # read가 깨어나 새 클라이언트를 읽고 그 결과가 새 연결에 귀속된다.
            # 에폭 검사도 여기(executor 스레드)에 있어야 한다. await 뒤에 두면
            # 취소된 코루틴이 아예 재개되지 않아 클라이언트가 그대로 샌다.
            if not self._io_lock.acquire(timeout=config.S7_TEARDOWN_LOCK_TIMEOUT_S):
                client.destroy()
                raise ConnectionError("이전 S7 세션이 정리되지 않아 연결할 수 없습니다.")
            try:
                if session != self._session:  # 그 사이 disconnect/취소됨
                    client.disconnect()
                    client.destroy()
                    raise ConnectionError("연결 시도가 취소되었습니다.")
                self._plc = client
            finally:
                self._io_lock.release()
            return client

        loop = asyncio.get_running_loop()
        client = await loop.run_in_executor(None, _connect)

        # 연결 검증은 get_cpu_state() 네트워크 왕복을 포함 → 이벤트 루프 밖에서 평가 (H5).
        # 읽기 경로에서는 제거했지만(예산 20% 낭비) connect 시에는 왕복 비용이 정당하다.
        if not await loop.run_in_executor(None, lambda: _client_alive(client)):
            raise ConnectionError(
                f"S7 연결 실패: {self._host}:{self._port} (rack={self._rack}, slot={self._slot})"
            )
        self._bt_ch = next((c for c in self._channels if c.get("role") == "BT"), None)
        self._et_ch = next((c for c in self._channels if c.get("role") == "ET"), None)
        self._hp_ch = next((c for c in self._channels if c.get("role") == "heater"), None)
        self._fc_ch = next((c for c in self._channels if c.get("role") == "fan"), None)
        self._drum_ch = next((c for c in self._channels if c.get("role") == "drum"), None)
        _log.info("S7Adapter connected: %s:%d", self._host, self._port)

    async def disconnect(self) -> None:
        # 1) 에폭 +1 — 진행 중인 connect가 뒤늦게 완료돼도 바인딩되지 않는다 (#208).
        # 2) _plc = None을 락보다 먼저 — 새 I/O를 즉시 차단한다(GIL 하 원자적).
        #    이 덕에 재연결 disconnect가 좀비 read 뒤에서 기다리지 않는다.
        self._session += 1
        plc = self._plc
        self._plc = None

        def _teardown() -> None:
            if plc is None:
                return
            # 락 없이 destroy()하면 다른 executor 스레드가 db_read 중인 클라이언트를
            # 해제해버린다 — 락을 도입한 이유가 정확히 이 경우다.
            if not self._io_lock.acquire(timeout=config.S7_TEARDOWN_LOCK_TIMEOUT_S):
                # 사용 중인 클라이언트를 destroy()하면 네이티브 크래시 위험이 있다.
                # 참조를 포기하면 snap7 Client.__del__이 결국 정리한다.
                _log.warning(
                    "S7 disconnect: %.1fs 내 I/O 락을 얻지 못해 클라이언트 참조를 포기합니다.",
                    config.S7_TEARDOWN_LOCK_TIMEOUT_S,
                )
                return
            try:
                try:
                    plc.disconnect()
                except Exception:
                    _log.exception("S7 plc.disconnect() failed during teardown")
                    pass
                try:
                    plc.destroy()
                except Exception:
                    _log.exception("S7 plc.destroy() failed during teardown")
                    pass
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _teardown)
        self._bt_ch = self._et_ch = self._hp_ch = self._fc_ch = self._drum_ch = None

    def _throttle(self) -> None:
        """요청 간 최소 간격(40ms) 보장. 스레드에서 호출."""
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_ts = time.monotonic()

    def _attempt_cost(self) -> float:
        """한 번의 db_read/db_write가 최악의 경우 잡아먹는 시간(초)."""
        return self._min_interval + config.S7_RECV_TIMEOUT_MS / 1000.0

    def _read_channel_sync(
        self, ch: dict[str, Any], plc: Any, deadline: float | None = None
    ) -> float:
        """스레드에서 실행. snap7 db_read → float 변환. retry 포함.

        plc는 인자로 받는다 — self._plc를 시도마다 다시 보면 그 사이 disconnect가
        None을 넣어 AttributeError가 난다. 한 번의 read는 한 클라이언트만 본다.

        deadline(벽시계)이 주어지면 남은 예산이 1회분에 못 미칠 때 시도를 멈춘다.
        상한이 채널 수와 무관하게 고정되므로 6채널 머신이 추가돼도 예산이 안 깨진다.
        """
        from snap7.util.getters import get_real, get_int  # type: ignore[import]

        db: int = ch["db"]
        offset: int = ch["offset"]
        ch_type: int = ch.get("type", 0)  # 0=int(2B), 1=float(4B)
        div: int = ch.get("div", 0)
        size = 4 if ch_type == 1 else 2

        last_exc: Exception = RuntimeError("S7 읽기 실패")
        attempted = False
        per_attempt = self._attempt_cost()
        for attempt in range(self._read_retries + 1):
            if deadline is not None and time.monotonic() + per_attempt > deadline:
                if attempted:
                    break  # retry 여유 없음 — 직전 실패를 그대로 올린다
                raise TimeoutError(
                    f"S7 읽기 예산 소진: db={db} offset={offset} — PLC 응답 없음"
                )
            attempted = True
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
                if ch.get("unit") not in ("%", "Pa", "Hz", "RPM"):
                    value = round(value, 1)
                TRACE.record(
                    "info", "s7",
                    f"decoded role={role} type={'REAL' if ch_type == 1 else 'INT'} div={div}",
                    value,
                )
                return value
            except Exception as exc:
                last_exc = exc
                TRACE.record("err", "s7", f"db={db} offset={offset} attempt={attempt + 1}: {exc}")
                _log.warning("S7 읽기 실패 (attempt %d/%d): db=%d offset=%d — %s",
                             attempt + 1, self._read_retries + 1, db, offset, exc)
        raise last_exc

    async def read(self) -> Reading:
        # 여기서는 핸들 유무만 확인한다. 실제 연결 검사(_client_alive)는 get_cpu_state()
        # 네트워크 왕복이라 이벤트 루프에서 하면 PLC 다운 시 aiohttp 전체가 멈춘다 (H5).
        if self._plc is None:
            raise ConnectionError("S7 PLC가 연결되지 않음")

        # 예산 시작은 락 획득 **이전** — 락 대기까지 상한에 포함해야
        # "executor 스레드가 manager의 wait_for 만료 전에 락을 놓는다"가 성립한다.
        deadline = time.monotonic() + config.S7_READ_BUDGET_S

        def _read_all() -> tuple[float, float, float | None, float, float]:
            if not self._io_lock.acquire(timeout=config.S7_IO_LOCK_TIMEOUT_S):
                raise TimeoutError("S7 I/O 락 획득 실패 — 이전 요청이 아직 진행 중입니다.")
            try:
                plc = self._plc
                if plc is None:
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                # get_connected()는 로컬 필드 확인(무비용)이라 읽기 경로에 둬도 된다.
                # 거짓 양성이 가능하므로 진짜 판정이 아니라 성능 가드일 뿐이다 —
                # 실제 판정은 아래 db_read 실패가 한다. (get_cpu_state는 왕복이라 제외)
                if not plc.get_connected():
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                bt = self._read_channel_sync(self._bt_ch, plc, deadline) if self._bt_ch else -1.0
                et = self._read_channel_sync(self._et_ch, plc, deadline) if self._et_ch else -1.0
                hp = self._read_channel_sync(self._hp_ch, plc, deadline) if self._hp_ch else None
                fc = self._read_channel_sync(self._fc_ch, plc, deadline) if self._fc_ch else 0.0
                drum = self._read_channel_sync(self._drum_ch, plc, deadline) if self._drum_ch else 0.0
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

        deadline = time.monotonic() + config.S7_READ_BUDGET_S

        def _read_one() -> float:
            if not self._io_lock.acquire(timeout=config.S7_IO_LOCK_TIMEOUT_S):
                raise TimeoutError("S7 I/O 락 획득 실패 — 이전 요청이 아직 진행 중입니다.")
            try:
                # 락 밖의 사전 검사와 여기 사이에 disconnect가 끼어들 수 있다
                plc = self._plc
                if plc is None:
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                return self._read_channel_sync(ch, plc, deadline)
            finally:
                self._io_lock.release()

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _read_one)

    def _write_channel_sync(
        self, role: str, spec: dict[str, Any], value: float, plc: Any
    ) -> int | float:
        """스레드에서 실행. clamp → div 역스케일 → value_offset → 인코딩 → db_write.

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

        value_offset = spec.get("value_offset", 0)
        if (
            isinstance(value_offset, bool)
            or not isinstance(value_offset, (int, float))
            or not math.isfinite(value_offset)
        ):
            raise ValueError(f"Invalid value_offset: role={role} value_offset={value_offset}")
        scaled = value * (10.0 if div == 1 else 100.0 if div == 2 else 1.0) + value_offset

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

        write_map에 없는 role은 조용히 무시한다. _plc가 없으면 쓰지 못한 것이므로
        성공으로 빠져나가면 안 된다 — manager가 그걸 200으로 보고한다 (#270).
        """
        requested = {"heater": heater, "fan": fan, "drum": drum}
        targets = [
            (role, self._write_map[role], float(value))
            for role, value in requested.items()
            if value is not None and role in self._write_map
        ]
        if not targets:
            return
        if self._plc is None:
            raise ConnectionError("S7 PLC가 연결되지 않음")

        def _write_all() -> None:
            # 최악: 락 0.5s + (스로틀 0.04 + RecvTimeout 0.5) = 1.04s.
            # PID tick이 느린 read와 경합해도 WRITE_FAIL 누적 대신 1회 실패로 끝난다.
            if not self._io_lock.acquire(timeout=config.S7_IO_LOCK_TIMEOUT_S):
                raise TimeoutError("S7 I/O 락 획득 실패 — 이전 요청이 아직 진행 중입니다.")
            try:
                plc = self._plc
                if plc is None:  # 사전 검사 이후 disconnect된 경우
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                for role, spec, value in targets:
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
        """connect 검증과 /status 전용 — get_cpu_state() 왕복을 포함한다.

        읽기 경로에서는 절대 쓰지 않는다(예산 초과의 주범이었다).
        """
        return _client_alive(self._plc)  # await 중 교체될 수 있어 스냅샷으로 넘긴다

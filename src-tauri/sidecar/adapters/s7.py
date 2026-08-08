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

        def _connect() -> None:
            self._plc = snap7.client.Client()
            # RecvTimeout 기본 3s → 1s. PLC가 응답 없이 hang하면 manager의
            # wait_for(3s)는 만료돼도 snap7 동기 호출이 잡은 executor 스레드는
            # 남는다 — 폴링마다 쌓이지 않게 블로킹 상한을 짧게 제한.
            self._plc.set_param(snap7.type.Parameter.RecvTimeout, 1000)
            self._plc.connect(self._host, self._rack, self._slot, self._port)
            time.sleep(0.2)  # Artisan: wait after connect for slow PLCs

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _connect)

        # connected는 get_cpu_state() 네트워크 왕복을 포함 → 이벤트 루프 밖에서 평가 (H5)
        if not await loop.run_in_executor(None, lambda: self.connected):
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
        def _disconnect() -> None:
            # 락 없이 destroy()하면 다른 executor 스레드가 db_read 중인 클라이언트를
            # 해제해버린다 — 락을 도입한 이유가 정확히 이 경우다.
            with self._io_lock:
                if self._plc is not None:
                    try:
                        self._plc.disconnect()
                        self._plc.destroy()
                    except Exception:
                        pass
                    self._plc = None

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _disconnect)
        self._bt_ch = self._et_ch = self._hp_ch = self._fc_ch = self._drum_ch = None

    def _throttle(self) -> None:
        """요청 간 최소 간격(40ms) 보장. 스레드에서 호출."""
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_ts = time.monotonic()

    def _read_channel_sync(self, ch: dict[str, Any]) -> float:
        """스레드에서 실행. snap7 db_read → float 변환. retry 포함."""
        from snap7.util.getters import get_real, get_int  # type: ignore[import]

        db: int = ch["db"]
        offset: int = ch["offset"]
        ch_type: int = ch.get("type", 0)  # 0=int(2B), 1=float(4B)
        div: int = ch.get("div", 0)
        size = 4 if ch_type == 1 else 2

        last_exc: Exception = RuntimeError("S7 읽기 실패")
        for attempt in range(self._read_retries + 1):
            self._throttle()
            try:
                role = ch.get("role", "?")
                TRACE.record("tx", "s7", f"db_read db={db} offset={offset} size={size} role={role}")
                ba: bytearray = self._plc.db_read(db, offset, size)
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
                return value
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

        def _read_all() -> tuple[float, float, float, float, float]:
            with self._io_lock:
                if not self.connected:
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                bt = self._read_channel_sync(self._bt_ch) if self._bt_ch else -1.0
                et = self._read_channel_sync(self._et_ch) if self._et_ch else -1.0
                hp = self._read_channel_sync(self._hp_ch) if self._hp_ch else 0.0
                fc = self._read_channel_sync(self._fc_ch) if self._fc_ch else 0.0
                drum = self._read_channel_sync(self._drum_ch) if self._drum_ch else 0.0
                return bt, et, hp, fc, drum

        loop = asyncio.get_running_loop()
        bt, et, hp, fc, drum = await loop.run_in_executor(None, _read_all)
        return Reading(bt=bt, et=et, heater=hp, fan=fc, drum=drum, timestamp=time.monotonic())

    async def read_raw_channel(self, role: str) -> float | None:
        """읽기 채널 하나만 조회. heater 피드백(Giesen DB2.48)처럼 Reading에 담기지 않는
        값을 PID engage/release 시점에 확인하는 용도. 미연결/미매핑이면 None."""
        ch = next((c for c in self._channels if c.get("role") == role), None)
        if ch is None or self._plc is None:
            return None

        def _read_one() -> float:
            with self._io_lock:
                # 락 밖의 사전 검사와 여기 사이에 disconnect가 끼어들 수 있다
                if self._plc is None:
                    raise ConnectionError("S7 PLC가 연결되지 않음")
                return self._read_channel_sync(ch)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _read_one)

    def _write_channel_sync(self, role: str, spec: dict[str, Any], value: float) -> int | float:
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
        self._plc.db_write(db, offset, ba)
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

        def _write_all() -> None:
            with self._io_lock:
                if self._plc is None:  # 사전 검사 이후 disconnect된 경우
                    return
                for role, spec, value in targets:
                    self._write_channel_sync(role, spec, value)

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
        try:
            return (self._plc is not None and
                    self._plc.get_connected() and
                    str(self._plc.get_cpu_state()) == "S7CpuStatusRun")
        except Exception:
            return False

import asyncio
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

    channels: roaster_registry의 "channels" 배열
      [{"role": "BT"|"ET"|"heater"|"fan", "db": N, "offset": N, "area": 6, "type": 0|1, "div": 0|1|2}, ...]
    type: 0=int (2 bytes), 1=float (4 bytes)
    area: 6=DB (DataBlock) — Giesen/Probat 모두 여기
    div:  0=raw, 1=÷10, 2=÷100

    snap7은 동기 API → run_in_executor로 이벤트 루프 블로킹 방지.
    read_retries=1, min_request_interval=0.04s (40ms) — artisan s7port.py 기준.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 102,
        rack: int = 0,
        slot: int = 0,
        channels: list[dict[str, Any]] | None = None,
        **_: Any,
    ) -> None:
        self._host = host
        self._port = port
        self._rack = rack
        self._slot = slot
        self._channels = channels or []
        self._plc: Any = None
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

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        pass  # 제어 기능 미사용 — 제거 예정

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

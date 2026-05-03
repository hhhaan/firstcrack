import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading

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
        self._min_interval: float = 0.04
        self._last_request_ts: float = 0.0
        # 채널 캐시 — connect() 시 한 번만 계산
        self._bt_ch: dict[str, Any] | None = None
        self._et_ch: dict[str, Any] | None = None
        self._hp_ch: dict[str, Any] | None = None
        self._fc_ch: dict[str, Any] | None = None

    async def connect(self) -> None:
        import snap7  # type: ignore[import]

        if not self._channels:
            raise ValueError("channels가 비어 있음. roaster_registry 확인 필요.")

        def _connect() -> None:
            self._plc = snap7.client.Client()
            self._plc.connect(self._host, self._rack, self._slot, self._port)

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _connect)

        if not self._plc.get_connected():
            raise ConnectionError(
                f"S7 연결 실패: {self._host}:{self._port} (rack={self._rack}, slot={self._slot})"
            )
        self._bt_ch = next((c for c in self._channels if c.get("role") == "BT"), None)
        self._et_ch = next((c for c in self._channels if c.get("role") == "ET"), None)
        self._hp_ch = next((c for c in self._channels if c.get("role") == "heater"), None)
        self._fc_ch = next((c for c in self._channels if c.get("role") == "fan"), None)
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
        self._bt_ch = self._et_ch = self._hp_ch = self._fc_ch = None

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
                ba: bytearray = self._plc.db_read(db, offset, size)
                if len(ba) != size:
                    raise IOError(f"db_read 응답 크기 불일치: {len(ba)} != {size}")
                value = float(get_real(ba, 0) if ch_type == 1 else get_int(ba, 0))
                if div == 1:
                    value /= 10.0
                elif div == 2:
                    value /= 100.0
                return round(value, 1)
            except Exception as exc:
                last_exc = exc
                _log.warning("S7 읽기 실패 (attempt %d/%d): db=%d offset=%d — %s",
                             attempt + 1, self._read_retries + 1, db, offset, exc)
        raise last_exc

    async def read(self) -> Reading:
        if self._plc is None or not self._plc.get_connected():
            raise ConnectionError("S7 PLC가 연결되지 않음")

        def _read_all() -> tuple[float, float, float, float]:
            bt = self._read_channel_sync(self._bt_ch) if self._bt_ch else -1.0
            et = self._read_channel_sync(self._et_ch) if self._et_ch else -1.0
            hp = self._read_channel_sync(self._hp_ch) if self._hp_ch else 0.0
            fc = self._read_channel_sync(self._fc_ch) if self._fc_ch else 0.0
            return bt, et, hp, fc

        loop = asyncio.get_running_loop()
        bt, et, hp, fc = await loop.run_in_executor(None, _read_all)
        return Reading(bt=bt, et=et, heater=hp, fan=fc, timestamp=time.monotonic())

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        pass  # S7 write_area 확장 시 여기에 구현

    @property
    def connected(self) -> bool:
        return self._plc is not None and self._plc.get_connected()

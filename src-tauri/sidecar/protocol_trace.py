"""
protocol_trace.py — 실기기 디버깅용 프로토콜 트레이스 (인메모리 링버퍼).

Artisan의 addserial()(Tx/Rx hex 덤프 로그)에 해당.
기본 ON. POST /debug/trace 로 런타임 토글.
어댑터들은 모듈 싱글턴 TRACE를 import해 record()를 호출한다.
begin/end 구간은 토글이 꺼져 있어도 그 사이 기록을 남기고, 예외 후에도 돌려준다.
S7처럼 executor 스레드에서 record()가 불려도 deque.append는 GIL 하에서
원자적이므로 별도 락이 필요 없다.
"""
import time
from collections import deque
from typing import Any

import config


class ProtocolTrace:
    def __init__(self, maxlen: int = config.TRACE_BUFFER_SIZE) -> None:
        self._buf: deque[dict[str, Any]] = deque(maxlen=maxlen)
        self.enabled: bool = False
        self._depth = 0
        self._restore_enabled = False

    def record(
        self,
        direction: str,
        protocol: str,
        detail: str,
        data: Any = None,
        *,
        force: bool = False,
    ) -> None:
        """direction: 'tx'|'rx'|'err'|'info'. data가 bytes면 hex 덤프로 변환."""
        if not self.enabled and not force:
            return
        if isinstance(data, (bytes, bytearray)):
            data = data.hex(" ")
        elif isinstance(data, str) and len(data) > 240:
            data = data[:240]
        self._buf.append(
            {
                "ts": round(time.monotonic(), 4),
                "dir": direction,
                "protocol": protocol,
                "detail": detail[:240],
                "data": data,
            }
        )

    def begin(self) -> float:
        """이 시각 이후의 기록을 end()가 돌려준다. 중첩되면 바깥 토글만 복원한다."""
        self._depth += 1
        if self._depth == 1:
            self._restore_enabled = self.enabled
        self.enabled = True
        return time.monotonic()

    def end(self, started: float, limit: int = 80) -> list[dict[str, Any]]:
        entries = [entry for entry in self._buf if entry["ts"] >= started]
        self._depth = max(0, self._depth - 1)
        if self._depth == 0:
            self.enabled = self._restore_enabled
        return entries[-limit:]

    def dump(self) -> list[dict[str, Any]]:
        return list(self._buf)

    def clear(self) -> None:
        self._buf.clear()


TRACE = ProtocolTrace()
TRACE.enabled = True

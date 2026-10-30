"""
protocol_trace.py — 실기기 디버깅용 프로토콜 트레이스 (인메모리 링버퍼).

Artisan의 addserial()(Tx/Rx hex 덤프 로그)에 해당.
기본 OFF. POST /debug/trace 로 런타임 토글.
어댑터들은 모듈 싱글턴 TRACE를 import해 record()를 호출한다.
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

    def record(self, direction: str, protocol: str, detail: str, data: Any = None) -> None:
        """direction: 'tx'|'rx'|'err'|'info'. data가 bytes면 hex 덤프로 변환."""
        if not self.enabled:
            return
        if isinstance(data, (bytes, bytearray)):
            data = data.hex(" ")
        self._buf.append(
            {
                "ts": round(time.monotonic(), 4),
                "dir": direction,
                "protocol": protocol,
                "detail": detail,
                "data": data,
            }
        )

    def dump(self) -> list[dict[str, Any]]:
        return list(self._buf)

    def clear(self) -> None:
        self._buf.clear()


TRACE = ProtocolTrace()

import asyncio
import logging
import time
from collections import deque
from typing import Any

from adapters import make_adapter
from roaster_registry import ROASTER_REGISTRY

_log = logging.getLogger(__name__)


class RoasterManager:
    def __init__(self) -> None:
        self._adapter: Any = None
        self._roaster_key: str = ""
        self._connected: bool = False
        self._error: str | None = None
        self._start_time: float = 0.0
        self._ror_window: deque[tuple[float, float]] = deque()
        self._lock: asyncio.Lock = asyncio.Lock()

    async def connect(self, roaster_key: str, params: dict[str, Any]) -> None:
        async with self._lock:
            if self._adapter is not None:
                await self._disconnect_internal()

            reg = ROASTER_REGISTRY.get(roaster_key)
            if reg is None:
                raise ValueError(f"알 수 없는 로스터: {roaster_key}")

            protocol = reg["protocol"]
            merged = {**reg["default_params"], **params}

            self._adapter = make_adapter(protocol, merged)
            self._roaster_key = roaster_key
            self._ror_window.clear()
            self._error = None

            try:
                await self._adapter.connect()
                self._connected = True
                self._start_time = time.monotonic()
            except Exception as exc:
                self._error = str(exc)
                self._connected = False
                _log.error("연결 실패 [%s]: %s", roaster_key, exc)

    async def disconnect(self) -> None:
        async with self._lock:
            await self._disconnect_internal()

    async def _disconnect_internal(self) -> None:
        if self._adapter is not None:
            try:
                await self._adapter.disconnect()
            except Exception:
                pass
        self._adapter = None
        self._connected = False
        self._roaster_key = ""
        self._ror_window.clear()

    async def read_temperatures(self) -> dict[str, Any]:
        if not self._connected or self._adapter is None:
            return {"bt": None, "et": None, "ror": 0.0, "heater": 0, "fan": 0, "timestamp": time.time()}
        try:
            reading = await self._adapter.read()
        except Exception as exc:
            self._error = str(exc)
            self._connected = False
            _log.error("읽기 실패: %s", exc)
            return {"bt": None, "et": None, "ror": 0.0, "heater": 0, "fan": 0, "timestamp": time.time()}

        if reading.bt > 0:
            self._add_to_ror_window(reading.timestamp, reading.bt)

        return {
            "bt": round(reading.bt, 1),
            "et": round(reading.et, 1),
            "ror": round(self._compute_ror(), 2),
            "heater": int(reading.heater),
            "fan": int(reading.fan),
            "timestamp": reading.timestamp,
        }

    async def start_roast(self) -> None:
        """UI의 Charge 버튼과 연동. 어댑터가 지원하면 타이머를 리셋하고, RoR 윈도우를 초기화."""
        async with self._lock:
            self._ror_window.clear()
            if self._adapter is not None and hasattr(self._adapter, "start_roast"):
                await self._adapter.start_roast()

    async def send_control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        if self._connected and self._adapter is not None:
            await self._adapter.control(heater=heater, fan=fan, drum=drum)

    def status(self) -> dict[str, Any]:
        uptime = round(time.monotonic() - self._start_time, 1) if self._connected else 0
        reg = ROASTER_REGISTRY.get(self._roaster_key, {})
        return {
            "connected": self._connected,
            "roaster": self._roaster_key,
            "display_name": reg.get("display_name", ""),
            "brand": reg.get("brand", ""),
            "uptime": uptime,
            "error": self._error,
        }

    def _add_to_ror_window(self, ts: float, bt: float) -> None:
        self._ror_window.append((ts, bt))
        cutoff = ts - 30.0
        while self._ror_window and self._ror_window[0][0] < cutoff:
            self._ror_window.popleft()

    def _compute_ror(self) -> float:
        """BT의 최근 30초 선형 최소제곱 기울기 (°C/min)."""
        if len(self._ror_window) < 2:
            return 0.0
        t0 = self._ror_window[0][0]
        xs = [(t - t0) / 60.0 for t, _ in self._ror_window]
        ys = [bt for _, bt in self._ror_window]
        n = len(xs)
        sx, sy = sum(xs), sum(ys)
        sxy = sum(x * y for x, y in zip(xs, ys))
        sx2 = sum(x * x for x in xs)
        denom = n * sx2 - sx * sx
        if abs(denom) < 1e-9:
            return 0.0
        return (n * sxy - sx * sy) / denom

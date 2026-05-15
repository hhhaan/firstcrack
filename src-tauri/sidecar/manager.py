import asyncio
import logging
import time
from collections import deque
from typing import Any

from adapters import make_adapter
from roaster_registry import ROASTER_REGISTRY

_log = logging.getLogger(__name__)


def _format_connection_error(exc: Exception, protocol: str, params: dict[str, Any]) -> str:
    """Python 예외를 사용자 친화적인 연결 오류 메시지로 변환."""
    msg = str(exc)
    exc_type = type(exc).__name__

    # ── 라이브러리/드라이버 미설치 ──────────────────────────────────────
    if "No module named 'snap7'" in msg:
        return "snap7 라이브러리가 설치되지 않았습니다. 설치 가이드를 확인하세요."
    if "No module named 'pymodbus'" in msg:
        return "pymodbus 라이브러리가 설치되지 않았습니다."
    if "No module named 'Phidget22'" in msg:
        return "Phidget22 SDK가 설치되지 않았습니다. phidgets.com에서 시스템 드라이버를 설치하세요."
    if "No module named 'websockets'" in msg:
        return "websockets 라이브러리가 설치되지 않았습니다."

    # ── 시리얼 포트 (MODBUS RTU, Kaleido Serial) ────────────────────────
    if protocol in ("modbus", "kaleido") and params.get("mode", "").lower() in ("rtu", "serial"):
        comport = params.get("comport", "")
        if "No such file or directory" in msg or "could not open port" in msg:
            return f"시리얼 포트 '{comport}'를 찾을 수 없습니다. 포트 이름과 케이블 연결을 확인하세요."
        if "Device or resource busy" in msg or "Access is denied" in msg:
            return f"시리얼 포트 '{comport}'가 다른 프로그램에서 사용 중입니다. 다른 앱을 종료 후 다시 시도하세요."
        if "Permission denied" in msg:
            return f"시리얼 포트 '{comport}' 접근 권한이 없습니다. (Linux: sudo usermod -aG dialout $USER)"

    # ── Phidget 장치 미연결 ──────────────────────────────────────────────
    if "PhidgetException" in exc_type or "EPHIDGET" in msg or "Not Attached" in msg:
        return "Phidget 장치가 감지되지 않습니다. USB 연결과 시스템 드라이버 설치를 확인하세요."
    if "Phidget" in exc_type and ("Timeout" in msg or "timed out" in msg.lower()):
        return "Phidget 장치 응답 없음. USB 케이블과 시스템 드라이버를 확인하세요."

    # ── 네트워크 연결 실패 ───────────────────────────────────────────────
    if "Connection refused" in msg:
        host = params.get("host", "")
        port = params.get("port", "")
        if protocol == "s7":
            return f"PLC({host}:{port})가 연결을 거부했습니다. 머신 전원과 S7 통신 설정을 확인하세요."
        if protocol in ("modbus", "probat_ws", "kaleido"):
            return f"{host}:{port} 연결이 거부됐습니다. 머신 전원과 IP/포트를 확인하세요."
        return f"연결이 거부됐습니다 ({host}:{port}). 머신 전원과 네트워크 설정을 확인하세요."

    if "timed out" in msg.lower() or exc_type in ("TimeoutError", "asyncio.TimeoutError"):
        host = params.get("host", "")
        if protocol == "s7":
            return f"PLC({host}) 응답 없음. 같은 네트워크에 있는지, IP 주소가 맞는지 확인하세요."
        return f"{host} 응답 없음. 머신이 같은 네트워크에 있는지 확인하세요."

    if "Network is unreachable" in msg or "No route to host" in msg:
        return f"호스트({params.get('host', '')})에 도달할 수 없습니다. 네트워크 연결을 확인하세요."

    # ── S7 PLC 연결 확인 실패 (snap7 connected=False) ───────────────────
    if "S7 연결 실패" in msg or ("S7" in msg and "연결" in msg):
        host = params.get("host", "")
        return f"S7 PLC({host}) 연결 실패. rack/slot 값과 머신 전원을 확인하세요."

    # ── MODBUS 연결 확인 실패 ────────────────────────────────────────────
    if "MODBUS 연결 실패" in msg:
        if params.get("mode", "tcp").lower() == "tcp":
            return f"MODBUS TCP 연결 실패 ({params.get('host')}:{params.get('port')}). IP와 포트를 확인하세요."
        return f"MODBUS RTU 연결 실패 ({params.get('comport')}). 시리얼 포트를 확인하세요."

    # ── fallback: 원본 메시지 ────────────────────────────────────────────
    return msg


class RoasterManager:
    def __init__(self) -> None:
        self._adapter: Any = None
        self._roaster_key: str = ""
        self._protocol: str = ""
        self._merged_params: dict[str, Any] = {}
        self._connected: bool = False
        self._data_ok: bool = False  # 실제 bt/et 값이 읽힌 적 있어야 connected로 판단
        self._error: str | None = None
        self._start_time: float = 0.0
        self._ror_window: deque[tuple[float, float]] = deque()
        self._et_ror_window: deque[tuple[float, float]] = deque()
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
            self._protocol = protocol
            self._merged_params = merged
            self._ror_window.clear()
            self._et_ror_window.clear()
            self._error = None

            try:
                await self._adapter.connect()
                self._connected = True
                self._start_time = time.monotonic()
            except Exception as exc:
                self._error = _format_connection_error(exc, protocol, merged)
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
        self._data_ok = False
        self._roaster_key = ""
        self._protocol = ""
        self._merged_params = {}
        self._ror_window.clear()
        self._et_ror_window.clear()

    async def read_temperatures(self) -> dict[str, Any]:
        if not self._connected or self._adapter is None:
            return {"bt": None, "et": None, "ror": 0.0, "ror_et": 0.0, "heater": 0, "fan": 0, "drum": 0, "timestamp": time.monotonic()}
        try:
            reading = await self._adapter.read()
        except Exception as exc:
            self._error = _format_connection_error(exc, self._protocol, self._merged_params)
            self._connected = False
            _log.error("읽기 실패: %s", exc)
            return {"bt": None, "et": None, "ror": 0.0, "ror_et": 0.0, "heater": 0, "fan": 0, "drum": 0, "timestamp": time.monotonic()}

        if reading.bt > 0:
            self._data_ok = True
            self._add_to_ror_window(reading.timestamp, reading.bt)
        if reading.et > 0:
            self._add_to_et_ror_window(reading.timestamp, reading.et)

        return {
            "bt": round(reading.bt, 1),
            "et": round(reading.et, 1),
            "ror": round(self._compute_ror(), 2),
            "ror_et": round(self._compute_et_ror(), 2),
            "heater": int(reading.heater),
            "fan": int(reading.fan),
            "drum": round(reading.drum, 1),
            "timestamp": reading.timestamp,
        }

    async def start_roast(self) -> None:
        """UI의 Charge 버튼과 연동. 어댑터가 지원하면 타이머를 리셋하고, RoR 윈도우를 초기화."""
        async with self._lock:
            self._ror_window.clear()
            self._et_ror_window.clear()
            if self._adapter is not None and hasattr(self._adapter, "start_roast"):
                await self._adapter.start_roast()

    async def send_control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        if self._connected and self._adapter is not None:
            await self._adapter.control(heater=heater, fan=fan, drum=drum)

    def status(self) -> dict[str, Any]:
        uptime = round(time.monotonic() - self._start_time, 1) if self._connected else 0
        reg = ROASTER_REGISTRY.get(self._roaster_key, {})
        return {
            "connected": self._connected and self._data_ok,
            "roaster": self._roaster_key,
            "display_name": reg.get("display_name", ""),
            "brand": reg.get("brand", ""),
            "capabilities": reg.get("capabilities", []),
            "uptime": uptime,
            "error": self._error,
        }

    def _add_to_ror_window(self, ts: float, bt: float) -> None:
        self._ror_window.append((ts, bt))
        cutoff = ts - 30.0
        while self._ror_window and self._ror_window[0][0] < cutoff:
            self._ror_window.popleft()

    def _add_to_et_ror_window(self, ts: float, et: float) -> None:
        self._et_ror_window.append((ts, et))
        cutoff = ts - 30.0
        while self._et_ror_window and self._et_ror_window[0][0] < cutoff:
            self._et_ror_window.popleft()

    def _compute_ror(self) -> float:
        """BT의 최근 30초 선형 최소제곱 기울기 (°C/min)."""
        return self._least_squares_slope(self._ror_window)

    def _compute_et_ror(self) -> float:
        """ET의 최근 30초 선형 최소제곱 기울기 (°C/min)."""
        return self._least_squares_slope(self._et_ror_window)

    def _least_squares_slope(self, window: deque[tuple[float, float]]) -> float:
        if len(window) < 2:
            return 0.0
        t0 = window[0][0]
        xs = [(t - t0) / 60.0 for t, _ in window]
        ys = [v for _, v in window]
        n = len(xs)
        sx, sy = sum(xs), sum(ys)
        sxy = sum(x * y for x, y in zip(xs, ys))
        sx2 = sum(x * x for x in xs)
        denom = n * sx2 - sx * sx
        if abs(denom) < 1e-9:
            return 0.0
        return (n * sxy - sx * sy) / denom

import asyncio
import logging
import time
from collections import deque
from typing import Any

import config
from adapters import make_adapter
from roaster_registry import ROASTER_REGISTRY

_log = logging.getLogger(__name__)


def _format_connection_error(
    exc: Exception, protocol: str, params: dict[str, Any]
) -> str:
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
    if protocol in ("modbus", "kaleido") and params.get("mode", "").lower() in (
        "rtu",
        "serial",
    ):
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
            return (
                f"{host}:{port} 연결이 거부됐습니다. 머신 전원과 IP/포트를 확인하세요."
            )
        return f"연결이 거부됐습니다 ({host}:{port}). 머신 전원과 네트워크 설정을 확인하세요."

    if "timed out" in msg.lower() or exc_type in (
        "TimeoutError",
        "asyncio.TimeoutError",
    ):
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
        return (
            f"MODBUS RTU 연결 실패 ({params.get('comport')}). 시리얼 포트를 확인하세요."
        )

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
        self._bt_ema: float | None = None
        self._et_ema: float | None = None
        self._bt_display_ema: float | None = None
        self._et_display_ema: float | None = None
        self._lock: asyncio.Lock = asyncio.Lock()
        self._reconnect_task: asyncio.Task[None] | None = None
        self._reconnect_attempt: int = 0
        self._ror_warmup: int = 0
        self._consecutive_errors: int = 0
        self._last_good: dict[str, Any] | None = None

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
            self._bt_ema = None
            self._et_ema = None
            self._bt_display_ema = None
            self._et_display_ema = None
            self._error = None
            self._ror_warmup = config.ROR_WARMUP_READS

            try:
                await self._adapter.connect()
                self._connected = True
                self._start_time = time.monotonic()
                # Warmup read: _data_ok를 connect 응답 전에 설정해 프론트엔드가 즉시 connected를 볼 수 있게 함
                try:
                    reading = await self._adapter.read()
                    if reading.bt > 0:
                        self._data_ok = True
                except Exception:
                    pass
            except Exception as exc:
                self._error = _format_connection_error(exc, protocol, merged)
                self._connected = False
                _log.error("연결 실패 [%s]: %s", roaster_key, exc, exc_info=True)

    async def disconnect(self) -> None:
        async with self._lock:
            await self._disconnect_internal()

    async def _disconnect_internal(self) -> None:
        if self._reconnect_task is not None and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            self._reconnect_task = None
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
        self._bt_ema = None
        self._et_ema = None
        self._bt_display_ema = None
        self._et_display_ema = None
        self._consecutive_errors = 0
        self._last_good = None

    async def _reconnect_loop(self) -> None:
        """읽기 실패 후 백그라운드 자동 재연결.

        config.RECONNECT_BACKOFFS를 소진한 뒤에는 마지막 간격으로 무한 재시도.
        사용자가 /disconnect 하면 _disconnect_internal()이 이 태스크를 취소한다.
        """
        attempt = 0
        try:
            while True:
                delay = config.RECONNECT_BACKOFFS[
                    min(attempt, len(config.RECONNECT_BACKOFFS) - 1)
                ]
                attempt += 1
                self._reconnect_attempt = attempt
                await asyncio.sleep(delay)
                if self._connected or self._adapter is None:
                    return
                async with self._lock:
                    if self._connected or self._adapter is None:
                        return
                    try:
                        _log.info("자동 재연결 시도 (%d): %s", attempt, self._roaster_key)
                        try:
                            await self._adapter.disconnect()
                        except Exception:
                            pass
                        await self._adapter.connect()
                        self._connected = True
                        self._error = None
                        _log.info("자동 재연결 성공: %s", self._roaster_key)
                        return
                    except Exception as exc:
                        self._error = _format_connection_error(
                            exc, self._protocol, self._merged_params
                        )
                        _log.error("재연결 실패 (%d): %s", attempt, exc)
        finally:
            self._reconnect_attempt = 0

    async def read_temperatures(self) -> dict[str, Any]:
        reconnecting = (
            self._reconnect_task is not None and not self._reconnect_task.done()
        )
        if not self._connected or self._adapter is None:
            return {
                "bt": None,
                "et": None,
                "ror": 0.0,
                "ror_et": 0.0,
                "heater": 0,
                "fan": 0,
                "drum": 0,
                "timestamp": time.monotonic(),
                "stale": False,
                "reconnecting": reconnecting,
            }
        try:
            reading = await self._adapter.read()
        except Exception as exc:
            self._consecutive_errors += 1
            if (
                self._consecutive_errors <= config.STALE_TOLERANCE_READS
                and self._last_good is not None
            ):
                # fail-open: 일시 오류는 이전 값을 유지해 로스팅을 계속한다 (Artisan 방식)
                _log.warning(
                    "읽기 실패 (%d/%d) — 이전 값 유지: %s",
                    self._consecutive_errors,
                    config.STALE_TOLERANCE_READS,
                    exc,
                )
                return {
                    **self._last_good,
                    "stale": True,
                    "reconnecting": reconnecting,
                    "timestamp": time.monotonic(),
                }
            self._error = _format_connection_error(
                exc, self._protocol, self._merged_params
            )
            self._connected = False
            _log.error("읽기 실패: %s", exc, exc_info=True)
            if self._reconnect_task is None or self._reconnect_task.done():
                self._reconnect_task = asyncio.create_task(self._reconnect_loop())
            return {
                "bt": None,
                "et": None,
                "ror": 0.0,
                "ror_et": 0.0,
                "heater": 0,
                "fan": 0,
                "drum": 0,
                "timestamp": time.monotonic(),
                "stale": False,
                "reconnecting": True,
            }

        self._consecutive_errors = 0

        if reading.bt > 0:
            self._data_ok = True
            self._add_to_ror_window(reading.timestamp, reading.bt)
        if reading.et > 0:
            self._add_to_et_ror_window(reading.timestamp, reading.et)

        if self._ror_warmup > 0:
            self._ror_warmup -= 1
            ror = 0.0
            ror_et = 0.0
        else:
            ror = round(self._compute_ror(), 2)
            ror_et = round(self._compute_et_ror(), 2)

        payload = {
            "bt": round(self._bt_display_ema if self._bt_display_ema is not None else reading.bt, 1),
            "et": round(self._et_display_ema if self._et_display_ema is not None else reading.et, 1),
            "ror": ror,
            "ror_et": ror_et,
            "heater": int(round(reading.heater)),
            "fan": int(round(reading.fan)),
            "drum": round(reading.drum, 1),
            "timestamp": reading.timestamp,
            "stale": False,
            "reconnecting": reconnecting,
        }
        self._last_good = payload
        return payload

    async def enter_standby(self) -> None:
        """UI의 READY 버튼과 연동. 어댑터가 지원하면 standby 진입을 알린다."""
        if self._adapter is not None and hasattr(self._adapter, "enter_standby"):
            await self._adapter.enter_standby()

    async def start_roast(self) -> None:
        """UI의 Charge 버튼과 연동. 어댑터가 지원하면 타이머를 리셋하고, RoR 윈도우를 초기화."""
        async with self._lock:
            self._ror_window.clear()
            self._et_ror_window.clear()
            self._bt_ema = None
            self._et_ema = None
            self._bt_display_ema = None
            self._et_display_ema = None
            self._ror_warmup = config.ROR_WARMUP_READS
            if self._adapter is not None and hasattr(self._adapter, "start_roast"):
                await self._adapter.start_roast()

    async def reset_roast(self) -> None:
        """로스트 종료 후 어댑터 상태를 초기화한다 (connect() 재호출). RoR 윈도우도 클리어."""
        async with self._lock:
            self._ror_window.clear()
            self._et_ror_window.clear()
            self._bt_ema = None
            self._et_ema = None
            self._bt_display_ema = None
            self._et_display_ema = None
            if self._adapter is not None and self._connected:
                await self._adapter.connect()

    def status(self) -> dict[str, Any]:
        uptime = round(time.monotonic() - self._start_time, 1) if self._connected else 0
        reg = ROASTER_REGISTRY.get(self._roaster_key, {})
        reconnecting = self._reconnect_task is not None and not self._reconnect_task.done()
        return {
            "connected": self._connected and self._data_ok,
            "reconnecting": reconnecting,
            "reconnect_attempt": self._reconnect_attempt,
            "roaster": self._roaster_key,
            "display_name": reg.get("display_name", ""),
            "brand": reg.get("brand", ""),
            "capabilities": reg.get("capabilities", []),
            "uptime": uptime,
            "error": self._error,
        }

    async def probe(self) -> dict[str, Any]:
        """단발 진단 읽기 — EMA/stale 처리를 우회하고 어댑터 원시 값과 소요 시간을 반환.

        실기기에서 Artisan과 값을 직접 비교(A/B)하기 위한 디버깅 전용 경로.
        """
        if self._adapter is None:
            return {"ok": False, "error": "연결된 어댑터 없음"}
        t0 = time.monotonic()
        try:
            r = await self._adapter.read()
            return {
                "ok": True,
                "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
                "raw": {
                    "bt": r.bt,
                    "et": r.et,
                    "heater": r.heater,
                    "fan": r.fan,
                    "drum": r.drum,
                },
            }
        except Exception as exc:
            return {
                "ok": False,
                "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
                "error": str(exc),
            }

    def _add_to_ror_window(self, ts: float, bt: float) -> None:
        if self._bt_ema is None:
            self._bt_ema = bt
        else:
            self._bt_ema = config.EMA_ALPHA * bt + (1.0 - config.EMA_ALPHA) * self._bt_ema
        if self._bt_display_ema is None:
            self._bt_display_ema = bt
        else:
            self._bt_display_ema = config.DISPLAY_ALPHA * bt + (1.0 - config.DISPLAY_ALPHA) * self._bt_display_ema
        self._ror_window.append((ts, self._bt_ema))
        cutoff = ts - config.ROR_WINDOW_SECS
        while self._ror_window and self._ror_window[0][0] < cutoff:
            self._ror_window.popleft()

    def _add_to_et_ror_window(self, ts: float, et: float) -> None:
        if self._et_ema is None:
            self._et_ema = et
        else:
            self._et_ema = config.EMA_ALPHA * et + (1.0 - config.EMA_ALPHA) * self._et_ema
        if self._et_display_ema is None:
            self._et_display_ema = et
        else:
            self._et_display_ema = config.DISPLAY_ALPHA * et + (1.0 - config.DISPLAY_ALPHA) * self._et_display_ema
        self._et_ror_window.append((ts, self._et_ema))
        cutoff = ts - config.ROR_WINDOW_SECS
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

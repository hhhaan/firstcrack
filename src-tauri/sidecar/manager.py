import asyncio
import logging
import math
import time
import uuid
from collections import deque
from typing import Any

import sentry_sdk

import config
from adapters import WRITABLE_PROTOCOLS, make_adapter
from control_guard import ControlRangeError, ControlUnavailable, clamp_command
from pid import PidGains
from pid_runner import STOP_HOLD, STOP_ZERO, PidRunner, PvSample
from roaster_registry import ROASTER_REGISTRY

_log = logging.getLogger(__name__)


class ConnectCancelled(Exception):
    """사용자가 /disconnect로 연결 시도를 취소했다 — 실패가 아니다.

    _error를 세우지 않는 것이 핵심이다. 취소를 연결 실패로 기록하면 UI에
    "연결 실패" 배너가 떠 사용자가 하지 않은 일에 대한 오답을 보게 된다.
    """


class SensorReadError(RuntimeError):
    """어댑터가 예외 없이 반환했지만 값이 센서 고장/분리를 뜻할 때 발생한다.

    실패를 -1.0 같은 센티넬 값으로 인코딩하는 어댑터(Phidget 분리, Kaleido
    핸드셰이크 유실, Probat 노드 누락)를 공통 read 경로에서 잡아, manager의
    stale → 재연결 계약으로 되돌리기 위한 예외다.
    """


def _validate_bt(bt: float) -> None:
    """BT는 필수 채널 — 물리적으로 불가능한 값이면 읽기 실패로 승격한다.

    ET는 검증하지 않는다. ET 미장착 머신에서 -1.0은 정상적인 "채널 없음" 값이라
    로스팅을 중단시킬 이유가 되지 않는다 (의도적 비대칭).
    """
    if not math.isfinite(bt) or bt <= config.BT_VALID_MIN_C or bt >= config.BT_VALID_MAX_C:
        raise SensorReadError(
            f"BT 센서 값이 유효 범위를 벗어났습니다 ({bt}). 프로브 연결과 센서 상태를 확인하세요."
        )


def _format_connection_error(
    exc: Exception,
    protocol: str,
    params: dict[str, Any],
    first_read_failure: bool = False,
) -> str:
    """Python 예외를 사용자 친화적인 연결 오류 메시지로 변환.

    first_read_failure=True: connect()는 성공했지만 첫 read부터 실패한 경우.
    포트/소켓은 열렸으므로 원본 예외(대개 timeout/IO 오류)가 사용자에게 도움이
    안 됨 — 설정 불일치(RTU/ASCII 프레이머, Unit ID 등)를 안내한다.
    """
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
        "ascii",
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

    if exc_type == "gaierror" or "nodename nor servname" in msg or "Name or service not known" in msg:
        return f"호스트({params.get('host', '')})를 찾을 수 없습니다. IP 주소를 확인하세요."

    if "Network is unreachable" in msg or "No route to host" in msg:
        return f"호스트({params.get('host', '')})에 도달할 수 없습니다. 네트워크 연결을 확인하세요."

    # ── S7 PLC 연결 확인 실패 (snap7 connected=False) ───────────────────
    if "S7 연결 실패" in msg or ("S7" in msg and "연결" in msg):
        host = params.get("host", "")
        return f"S7 PLC({host}) 연결 실패. rack/slot 값과 머신 전원을 확인하세요."

    # ── MODBUS 연결 확인 실패 ────────────────────────────────────────────
    if "MODBUS 연결 실패" in msg:
        if params.get("mode", "tcp").lower() in ("tcp", "udp"):
            return f"MODBUS {params.get('mode', 'tcp').upper()} 연결 실패 ({params.get('host')}:{params.get('port')}). IP와 포트를 확인하세요."
        return (
            f"MODBUS RTU 연결 실패 ({params.get('comport')}). 시리얼 포트를 확인하세요."
        )

    # ── 연결은 됐지만 첫 read부터 실패 (설정 불일치 의심) ──────────────────
    if first_read_failure and protocol == "modbus":
        if params.get("mode", "tcp").lower() in ("tcp", "udp"):
            return "연결됐지만 장치가 응답하지 않습니다. Unit ID와 레지스터 설정을 확인하세요."
        return (
            "포트는 열렸지만 장치가 응답하지 않습니다. "
            "연결 방식(RTU/ASCII)·Baud Rate·Unit ID를 확인하세요."
        )

    # ── fallback: 원본 메시지 ────────────────────────────────────────────
    return msg


_MAP_KEYS = ("write_map", "channels")


def _has_real_map(value: Any) -> bool:
    """클라이언트가 레지스트리 맵을 교체할 실제 맵을 보냈는지."""
    if isinstance(value, dict):
        return len(value) > 0
    if isinstance(value, (list, tuple)):
        return len(value) > 0
    return False


def _merge_connect_params(
    defaults: dict[str, Any], params: dict[str, Any]
) -> dict[str, Any]:
    """레지스트리 default_params 위에 클라이언트 파라미터를 얹는다.

    빈 write_map/channels 는 저장된 커스텀이 아니라 '없음'이다. 얕은 merge가
    알려진 머신의 주소 맵을 통째로 지우지 않게 레지스트리 값을 유지한다 (#270).
    """
    merged = {**defaults, **params}
    for key in _MAP_KEYS:
        if key not in params:
            continue
        if not _has_real_map(params[key]) and key in defaults:
            merged[key] = defaults[key]

    for role in ("BT", "ET"):
        key = f"{role.lower()}_register"
        if key in params:
            value = params[key]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 65535:
                raise ValueError(f"{key} must be an integer from 0 to 65535")
            registers = merged.get("modbus_registers")
            channel = registers.get(role) if isinstance(registers, dict) else None
            if not isinstance(channel, dict):
                raise ValueError(f"{role} register is not available for this model")
            merged["modbus_registers"] = {
                **merged["modbus_registers"], role: {**channel, "register": value}
            }

        for field, max_value in (("db", 65535), ("offset", 2147483647)):
            key = f"{role.lower()}_{field}"
            if key not in params:
                continue
            value = params[key]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= max_value:
                raise ValueError(f"{key} must be an integer from 0 to {max_value}")
            channels = merged.get("channels")
            if not isinstance(channels, list) or not any(
                isinstance(channel, dict) and channel.get("role") == role
                for channel in channels
            ):
                raise ValueError(f"{role} channel is not available for this model")
            merged["channels"] = [
                {**channel, field: value}
                if isinstance(channel, dict) and channel.get("role") == role
                else channel
                for channel in channels
            ]
    return merged


class RoasterManager:
    def __init__(self) -> None:
        self._adapter: Any = None
        self._roaster_key: str = ""
        self._protocol: str = ""
        self._merged_params: dict[str, Any] = {}
        self._connected: bool = False
        self._error: str | None = None
        self._start_time: float = 0.0
        self._ror_window: deque[tuple[float, float]] = deque()
        self._et_ror_window: deque[tuple[float, float]] = deque()
        self._bt_ema: float | None = None
        self._et_ema: float | None = None
        self._bt_display_ema: float | None = None
        self._et_display_ema: float | None = None
        self._lock: asyncio.Lock = asyncio.Lock()
        # 센서 갱신 직렬화 — 프론트 폴링과 PID tick이 같은 순간에 읽어도
        # EMA/RoR이 두 번 밀리지 않게 한다 (표시 RoR 오염 방지).
        self._read_lock: asyncio.Lock = asyncio.Lock()
        self._reconnect_task: asyncio.Task[None] | None = None
        # 진행 중인 adapter.connect() 핸들. connect()와 _reconnect_loop() 두 호출
        # 지점이 모두 여기 있어 취소 대상을 한 곳으로 모은다.
        self._connect_task: asyncio.Task[None] | None = None
        self._connect_cancel_requested: bool = False
        self._reconnect_attempt: int = 0
        self._ror_warmup: int = 0
        self._consecutive_errors: int = 0
        self._last_good: dict[str, Any] | None = None
        self._last_good_ts: float = 0.0
        self._connection_epoch: int = 0
        self._sensor_clock_id = uuid.uuid4().hex
        # role → 이 연결에서 마지막으로 어댑터에 쓴(클램프 후) 값. /temperatures의
        # heater_set 출처. 수동·Replay·PID 쓰기가 전부 control()을 지나므로 여기서 잡힌다.
        # 본체 조작반에서 돌린 값은 모른다 — 세트포인트 셀 readback이 붙기 전까지.
        self._last_applied: dict[str, float] = {}
        self._ror_window_secs: float = config.ROR_WINDOW_SECS
        self._pid: PidRunner | None = None
        self._pid_task: asyncio.Task[None] | None = None
        # reset_roast 구간. control/PID write만 막는다 — PID 루프 전체를
        # connect lock에 넣지 않는다 (#270).
        self._resetting: bool = False
        # once=True 캡처가 이미 나간 event. 성공/disconnect 때 비운다.
        self._hw_alerts_sent: set[str] = set()

    def _capture_hardware_error(
        self, exc: Exception, event: str = "hardware_error", *, once: bool = False
    ) -> None:
        """하드웨어 에러를 Sentry/Slack에 캡처 — 프로토콜/로스터 정보 포함.

        once=True면 같은 event는 성공할 때까지 한 번만 쏜다. /pid/off 자동
        재시도가 5초마다 같은 쓰기를 반복해도 채널을 채우지 않게 한다.
        반복분은 breadcrumb만 남겨 다음 실사고에 붙는다.
        """
        try:
            if once and event in self._hw_alerts_sent:
                sentry_sdk.add_breadcrumb(
                    category="hardware",
                    message=f"{event} (duplicate suppressed)",
                    level="error",
                    data={
                        "roaster": self._roaster_key,
                        "protocol": self._protocol,
                        "type": type(exc).__name__,
                    },
                )
                return
            sentry_sdk.set_tag("roaster", self._roaster_key)
            sentry_sdk.set_tag("protocol", self._protocol)
            sentry_sdk.set_tag("event", event)
            sentry_sdk.set_context(
                "sidecar",
                {
                    "protocol": self._protocol,
                    "roaster": self._roaster_key,
                    "event": event,
                    "consecutive_errors": self._consecutive_errors,
                    "reconnect_attempt": self._reconnect_attempt,
                },
            )
            # host/comport는 남기지 않는다 — 연결 대상 자체가 식별정보이고, 어느
            # 장비에서 났는지는 roaster/protocol/mode로 이미 좁혀진다.
            if self._merged_params:
                sentry_sdk.set_tag("mode", self._merged_params.get("mode"))
            sentry_sdk.capture_exception(exc)
            if once:
                self._hw_alerts_sent.add(event)
            try:
                from slack_notify import notify_hardware_error

                # Sync HTTP — do not block aiohttp event loop during reconnect/temp reads.
                asyncio.get_running_loop().run_in_executor(
                    None,
                    lambda: notify_hardware_error(
                        event=event,
                        roaster=self._roaster_key,
                        protocol=self._protocol,
                        exc=exc,
                    ),
                )
            except Exception:
                _log.exception("Slack hardware error notify scheduling failed (event=%s)", event)
                pass
        except Exception:
            _log.exception("_capture_hardware_error failed (event=%s)", event)
            pass

    async def _run_adapter_connect(self, adapter: Any) -> None:
        """adapter.connect() **한 줄만** 취소 가능한 태스크로 감싼다.

        connect() 전체를 감싸면 취소 시 매니저 상태가 반쪽으로 남는다. 취소 지점을
        핸드셰이크 한 줄로 좁히고 정리는 호출자(except ConnectCancelled)에 맡긴다.
        """
        task = asyncio.create_task(adapter.connect())
        self._connect_task = task
        try:
            await task
        finally:
            # 사용자 disconnect로 inner task가 취소된 경우만 ConnectCancelled.
            # 핸들러 자체 취소(소켓 끊김)는 CancelledError를 그대로 올린다.
            requested = task.cancelled() and self._connect_cancel_requested
            self._connect_task = None
            self._connect_cancel_requested = False
            if requested:
                raise ConnectCancelled

    def _cancel_pending_connect(self) -> None:
        """진행 중인 연결 시도를 락 **밖에서** 취소한다.

        _disconnect_internal의 재연결 취소는 락을 얻은 뒤에야 실행되므로,
        재연결 루프가 락을 쥔 채 connect 중이면 서로를 기다리는 데드락이 된다.
        """
        task = self._connect_task
        if task is not None and not task.done():
            self._connect_cancel_requested = True
            task.cancel()
        rt = self._reconnect_task
        if rt is not None and not rt.done():
            rt.cancel()

    async def connect(self, roaster_key: str, params: dict[str, Any]) -> None:
        async with self._lock:
            if self._adapter is not None:
                await self._disconnect_internal()
            self._connection_epoch += 1

            reg = ROASTER_REGISTRY.get(roaster_key)
            if reg is None:
                raise ValueError(f"알 수 없는 로스터: {roaster_key}")

            protocol = reg["protocol"]
            merged = _merge_connect_params(reg["default_params"], params)

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
            # 이전 머신의 값이 stale 응답으로 새 연결에 새어나오지 않게 한다
            self._consecutive_errors = 0
            self._last_good = None

            try:
                await self._run_adapter_connect(self._adapter)
                self._connected = True
                self._start_time = time.monotonic()
                _log.info("연결 성공 [%s]: %s", roaster_key, protocol)
                sentry_sdk.set_tag("roaster", roaster_key)
                sentry_sdk.set_tag("protocol", protocol)
                sentry_sdk.add_breadcrumb(
                    category="hardware",
                    message=f"connected: {roaster_key} ({protocol})",
                    level="info",
                )
            # ConnectCancelled는 Exception의 하위라 반드시 아래 절보다 **위**에 온다.
            except ConnectCancelled:
                # 사용자가 취소했다 — 부분 연결만 정리하고 오류로 남기지 않는다.
                try:
                    await self._adapter.disconnect()
                except Exception:
                    _log.exception("adapter.disconnect() failed after connect cancelled [%s]", roaster_key)
                    pass
                self._adapter = None
                self._connected = False
                self._error = None
                self._roaster_key = ""
                self._protocol = ""
                self._merged_params = {}
                _log.info("연결 시도 취소됨 [%s]: %s", roaster_key, protocol)
            except Exception as exc:
                # 부분 연결(소켓/스레드) 정리 — status용 메타는 유지
                try:
                    await self._adapter.disconnect()
                except Exception:
                    _log.exception("adapter.disconnect() failed after connect_failed [%s]", roaster_key)
                    pass
                self._error = _format_connection_error(exc, protocol, merged)
                self._connected = False
                self._protocol = protocol
                self._roaster_key = roaster_key
                self._merged_params = merged
                _log.error("연결 실패 [%s]: %s", roaster_key, exc, exc_info=True)
                self._capture_hardware_error(exc, "connect_failed")

    async def disconnect(self) -> None:
        # 락을 잡기 **전에** 취소한다. connect/재연결이 핸드셰이크 내내 같은 락을
        # 쥐고 있어(Kaleido 15s, Phidget 10s), 락을 먼저 기다리면 프론트 요청이
        # 타임아웃돼 "해제 버튼이 안 먹는다"가 된다. async with는 CancelledError
        # 에서도 락을 반납하므로 취소 → 보유자 정리·반납 → disconnect 획득이 된다.
        self._cancel_pending_connect()
        async with self._lock:
            await self._disconnect_internal()

    async def _disconnect_internal(self) -> None:
        self._connection_epoch += 1
        # Heater 0 before closing the write gate. control() refuses writes once
        # _connected is False, so STOP_ZERO must run first (#219).
        if self._pid is not None:
            try:
                await self._pid.stop("disconnect", mode=STOP_ZERO)
            except Exception:
                _log.exception("pid.stop() failed during disconnect [%s]", self._roaster_key)
                pass
        # 쓰기 게이트를 첫 await보다 먼저 닫는다. cancel()은 기다리지 않으므로
        # 이미 control() 안에 진입한 tick이 아래 await 도중 재개해 한 번 더 쓸 수 있다.
        self._connected = False
        # PID를 먼저 세운다 — 연결이 사라진 뒤 duty를 쓰려 드는 tick을 막는다
        if self._pid_task is not None and not self._pid_task.done():
            self._pid_task.cancel()
        self._pid_task = None
        self._pid = None
        if self._reconnect_task is not None and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            self._reconnect_task = None
        if self._adapter is not None:
            try:
                await self._adapter.disconnect()
            except Exception:
                _log.exception("adapter.disconnect() failed during _disconnect_internal [%s]", self._roaster_key)
                pass
        if self._roaster_key:
            sentry_sdk.add_breadcrumb(
                category="hardware",
                message=f"disconnected: {self._roaster_key} ({self._protocol})",
                level="info",
            )
        self._adapter = None
        self._connected = False
        self._resetting = False
        self._last_applied = {}
        self._roaster_key = ""
        self._protocol = ""
        self._merged_params = {}
        self._hw_alerts_sent.clear()
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
                        self._connection_epoch += 1
                        try:
                            await self._adapter.disconnect()
                        except Exception:
                            _log.exception("adapter.disconnect() failed before reconnect attempt (%d) [%s]", attempt, self._roaster_key)
                            pass
                        await self._run_adapter_connect(self._adapter)
                        self._connected = True
                        self._consecutive_errors = 0
                        self._error = None
                        self._ror_window.clear()
                        self._et_ror_window.clear()
                        self._bt_ema = None
                        self._et_ema = None
                        self._bt_display_ema = None
                        self._et_display_ema = None
                        self._ror_warmup = config.ROR_WARMUP_READS
                        self._hw_alerts_sent.discard("reconnect_failed")
                        _log.info("자동 재연결 성공: %s", self._roaster_key)
                        sentry_sdk.add_breadcrumb(
                            category="hardware",
                            message=f"reconnected: {self._roaster_key} ({self._protocol}) after {attempt} attempts",
                            level="info",
                        )
                        await self._safety_after_reconnect()
                        return
                    except ConnectCancelled:
                        # 사용자가 /disconnect 했다. 여기서는 어댑터를 건드리지 않는다 —
                        # 이 절은 await 없이 끝나야 한다(이 태스크도 cancel 대상이라
                        # 다음 await에서 CancelledError가 정리 도중 꽂힌다).
                        # 어댑터 정리는 곧이어 실행될 _disconnect_internal이 맡는다.
                        return
                    except Exception as exc:
                        self._error = _format_connection_error(
                            exc, self._protocol, self._merged_params
                        )
                        _log.error("재연결 실패 (%d): %s", attempt, exc)
                        sentry_sdk.add_breadcrumb(
                            category="hardware",
                            message=f"reconnect failed ({attempt}): {exc}",
                            level="error",
                        )
                        # 무한 재시도 루프다 — 사고 1건에 이슈 1건. 나머지 시도는
                        # 위 breadcrumb만 남는다. 재연결 성공 시 다시 열린다.
                        self._capture_hardware_error(exc, "reconnect_failed", once=True)
        finally:
            self._reconnect_attempt = 0

    async def _safety_after_reconnect(self) -> None:
        """Reconnect must not leave FAULT PID or last heater duty stuck (#205)."""
        # PID를 켠 적 없거나 껐다 둔 수동/Replay 로스팅의 화력을 덮어쓰면 안 된다 (#317).
        # pid_stop은 _pid를 지우지 않으므로 객체 유무만 보면 "켰다 끈 세션"이 순단마다
        # heater 0(클래식 Giesen은 1%)을 맞는다 — running/holding/fault만 정지 대상이다.
        if self._pid is None or self._pid.state_name == "off":
            return
        try:
            if self._pid is not None and self._pid.state_name != "off":
                await self._pid.stop("reconnect", mode=STOP_ZERO)
        except Exception:
            _log.exception("pid.stop() failed during _safety_after_reconnect [%s]", self._roaster_key)
            pass
        try:
            if self._adapter is not None:
                await self._adapter.control(heater=0.0)
                # control()을 우회하는 쓰기 — heater_set도 같이 맞춘다 (어댑터와 같은 클램프)
                self._last_applied.update(clamp_command({"heater": 0.0}, self.write_limits()))
        except Exception:
            pass

    def _reconnecting(self) -> bool:
        return self._reconnect_task is not None and not self._reconnect_task.done()

    def _null_payload(self, reconnecting: bool) -> dict[str, Any]:
        """연결 없음/읽기 실패 시의 빈 응답. bt=None은 프론트의 연결 끊김 신호다."""
        return {
            "bt": None,
            "bt_raw": None,
            "et": None,
            "et_raw": None,
            "ror": 0.0,
            "ror_et": 0.0,
            "heater": None,
            "fan": 0,
            "drum": 0,
            "timestamp": time.monotonic(),
            "stale": False,
            "reconnecting": reconnecting,
        }

    async def read_temperatures(self, max_age: float = 0.0) -> dict[str, Any]:
        """센서 갱신의 단일 창구.

        EMA/RoR/에러 카운터/재연결을 건드리는 유일한 경로다. 프론트 폴링과 PID
        tick이 각자 어댑터를 읽으면 같은 EMA에 표본이 두 배로 들어가 화면 RoR이
        실제와 달라진다.

        max_age > 0이면 그만큼 최근 값은 재사용한다 — PID tick이 프론트가 방금
        읽은 표본을 그대로 쓰게 해 하드웨어 왕복을 줄인다.
        """
        async with self._read_lock:
            if max_age > 0 and self._last_good is not None:
                if (time.monotonic() - self._last_good_ts) <= max_age:
                    return self._last_good
            return await self._refresh_reading()

    async def _refresh_reading(self) -> dict[str, Any]:
        reconnecting = self._reconnecting()
        # await 도중 disconnect/재연결로 self._adapter가 교체될 수 있어 스냅샷을 잡는다 (H4)
        adapter = self._adapter
        if not self._connected or adapter is None:
            return self._null_payload(reconnecting)
        try:
            # 어댑터 hang 시 /temperatures가 무기한 pending 되지 않도록 전역 타임아웃 (H7).
            # 주의: executor 스레드에서 도는 동기 드라이버 자체는 중단되지 않는다.
            reading = await asyncio.wait_for(adapter.read(), timeout=config.READ_TIMEOUT)
            # 예외 없이 돌아온 센티넬/NaN도 실패로 승격 — 아래 except가 stale/재연결을 담당 (H1)
            _validate_bt(reading.bt)
        except Exception as exc:
            if self._adapter is not adapter:
                # 읽는 도중 disconnect/재연결됨 — 사라진 어댑터의 실패는 조용히 버린다 (H4)
                return self._null_payload(self._reconnecting())
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
                sentry_sdk.add_breadcrumb(
                    category="hardware",
                    message=f"stale read ({self._consecutive_errors}/{config.STALE_TOLERANCE_READS}): {exc}",
                    level="warning",
                )
                return {
                    **self._last_good,
                    "stale": True,
                    "bt_raw": None,
                    "et_raw": None,
                    "reconnecting": reconnecting,
                    "timestamp": time.monotonic(),
                }
            # 첫 read부터 실패(유지할 이전 값이 없음) = 연결은 됐지만 설정 불일치 의심.
            # 정상 동작 중 끊김(하드웨어/케이블 가능성)과 Sentry에서 구분 집계한다.
            first_read_failure = self._last_good is None
            event = "first_read_failed" if first_read_failure else "read_failed_disconnected"
            self._error = _format_connection_error(
                exc, self._protocol, self._merged_params, first_read_failure
            )
            self._connected = False
            # Sentry 이슈는 _capture_hardware_error가 담당한다. ERROR+exc_info는
            # LoggingIntegration이 같은 예외를 한 번 더 이슈로 만든다 (FC-1P).
            _log.warning("읽기 실패: %s", exc, exc_info=True)
            sentry_sdk.add_breadcrumb(
                category="hardware",
                message=f"{event}: {self._roaster_key} ({self._protocol}) — {exc}",
                level="error",
            )
            self._capture_hardware_error(exc, event)
            if self._reconnect_task is None or self._reconnect_task.done():
                self._reconnect_task = asyncio.create_task(self._reconnect_loop())
            return self._null_payload(reconnecting=True)

        if self._adapter is not adapter:
            # 성공 응답이 disconnect 이후에 도착 — _last_good/에러 카운터를 오염시키지 않는다 (H4)
            return self._null_payload(self._reconnecting())

        if self._consecutive_errors > 0:
            sentry_sdk.add_breadcrumb(
                category="hardware",
                message=f"read recovered: {self._roaster_key} after {self._consecutive_errors} errors",
                level="info",
            )
        self._consecutive_errors = 0

        if reading.bt > 0:
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
            "bt_raw": reading.bt,
            "bt": round(self._bt_display_ema if self._bt_display_ema is not None else reading.bt, 1),
            # ET는 범위 검증하지 않는다. 미장착 프로브의 -1.0도 원본으로 남긴다.
            "et_raw": reading.et,
            "et": round(self._et_display_ema if self._et_display_ema is not None else reading.et, 1),
            "ror": ror,
            "ror_et": ror_et,
            # None = 화력 피드백 채널 없음. 0으로 바꾸면 TSV에 "측정 0"으로 남아
            # Replay가 빈 기록을 진짜 화력 0으로 재생한다.
            "heater": int(round(reading.heater)) if reading.heater is not None else None,
            "fan": int(round(reading.fan)),
            "drum": round(reading.drum, 1),
            "timestamp": reading.timestamp,
            "sensor_clock": f"{self._sensor_clock_id}:{self._connection_epoch}",
            "processing": {
                "algorithm_version": config.MEASUREMENT_ALGORITHM_VERSION,
                "temperature_unit": "C",
                "ror_unit": "C/min",
                "timestamp_clock": "sidecar-monotonic-seconds",
                "display_ema_alpha": config.DISPLAY_ALPHA,
                "ror_ema_alpha": config.EMA_ALPHA,
                "ror_window_sec": self._ror_window_secs,
                "ror_warmup_reads": config.ROR_WARMUP_READS,
            },
            "stale": False,
            "reconnecting": reconnecting,
        }
        self._last_good = payload
        self._last_good_ts = time.monotonic()
        return payload

    def last_applied(self) -> dict[str, float]:
        """이 연결에서 마지막으로 쓴 role별 값. 쓴 적 없으면 빈 dict."""
        return dict(self._last_applied)

    def write_limits(self) -> dict[str, dict[str, Any]]:
        """쓰기 가능한 role → spec(min/max/unit). 빈 dict면 이 머신은 제어 불가.

        어댑터가 아니라 병합된 연결 파라미터에서 읽는다 — 쓰기 가능 여부는
        레지스트리가 정하는 사실이고, 어댑터마다 속성을 노출할 필요가 없다.
        """
        return dict(self._merged_params.get("write_map") or {})

    def _control_writable(self) -> bool:
        """실제로 하드웨어에 쓸 수 있는지. write_map ∩ WRITABLE_PROTOCOLS."""
        return bool(self.write_limits()) and self._protocol in WRITABLE_PROTOCOLS

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> dict[str, float]:
        """제어 명령을 어댑터로 전달하고 **실제 적용된 값**을 돌려준다.

        미연결/쓰기 미지원이면 ControlUnavailable을 던진다. 조용히 성공을
        반환하면 UI가 명령이 먹은 것으로 오해한다 — 화력 제어에서는 치명적이다.
        """
        requested = {k: v for k, v in
                     (("heater", heater), ("fan", fan), ("drum", drum)) if v is not None}
        if not requested:
            return {}

        # read와 동일하게 어댑터를 스냅샷 — await 도중 disconnect되면 조용히 무시한다 (H4)
        adapter = self._adapter
        if self._resetting:
            raise ControlUnavailable("로스터 초기화 중입니다.")
        if not self._connected or adapter is None:
            raise ControlUnavailable("머신이 연결되지 않았습니다.")
        if self._protocol not in WRITABLE_PROTOCOLS:
            raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

        write_map = self.write_limits()
        if not write_map:
            raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")
        unsupported = [r for r in requested if r not in write_map]
        if unsupported:
            raise ControlRangeError(
                f"이 머신은 {', '.join(unsupported)} 제어를 지원하지 않습니다."
            )

        applied = clamp_command({k: float(v) for k, v in requested.items()}, write_map)
        epoch = self._connection_epoch
        try:
            await adapter.control(**applied)
        except Exception:
            if self._adapter is not adapter:
                return {}
            self._control_breadcrumb(applied, ok=False)
            raise
        if self._adapter is not adapter or not self._connected or self._resetting or self._connection_epoch != epoch:
            return {}
        self._control_breadcrumb(applied, ok=True)
        self._last_applied.update(applied)
        return applied

    def _control_breadcrumb(self, applied: dict[str, float], *, ok: bool) -> None:
        """제어 쓰기 궤적 — 에러 이벤트에 첨부될 문맥. 값 시계열은 남기지 않는다."""
        sentry_sdk.add_breadcrumb(
            category="control",
            message="control write ok" if ok else "control write failed",
            level="info" if ok else "error",
            data={
                "roaster": self._roaster_key,
                "protocol": self._protocol,
                "roles": sorted(applied),
            },
        )

    # ── 소프트웨어 PID ─────────────────────────────────────────────────────

    def pid_capability(self) -> dict[str, Any]:
        """PID 지원 여부(정적). 게인 + heater 쓰기 + 실제 쓰기 프로토콜."""
        reg = ROASTER_REGISTRY.get(self._roaster_key, {})
        gains = reg.get("pid")
        supported = (
            bool(gains)
            and "heater" in self.write_limits()
            and self._control_writable()
        )
        return {
            "supported": supported,
            "sv_min": config.PID_SV_MIN_C,
            "sv_max": config.PID_SV_MAX_C,
        }

    def pid_state(self) -> dict[str, Any] | None:
        return self._pid.state() if self._pid is not None else None

    async def _pv_snapshot(self) -> PvSample:
        """PID가 쓰는 표본. 화면과 같은 평활 BT를 쓴다 — 조작자와 제어기가 같은 값을 본다."""
        payload = await self.read_temperatures(max_age=config.READING_MAX_AGE_S)
        return PvSample(
            bt=payload.get("bt"),
            ts=time.monotonic(),
            stale=bool(payload.get("stale")),
            connected=self._connected,
        )

    async def _pid_write_duty(self, duty: float) -> None:
        applied = await self.control(heater=duty)
        if not applied:
            raise RuntimeError("duty 쓰기가 적용되지 않았습니다.")

    async def _pid_read_feedback(self) -> float | None:
        """머신이 보고하는 현재 heater 값. bumpless engage와 graceful stop에 쓴다."""
        payload = await self.read_temperatures(max_age=config.READING_MAX_AGE_S)
        value = payload.get("heater")
        return float(value) if value is not None else None

    async def pid_start(self, sv: float) -> dict[str, Any]:
        cap = self.pid_capability()
        if not self._connected:
            raise ControlUnavailable("머신이 연결되지 않았습니다.")
        if not cap["supported"]:
            raise ControlUnavailable("이 머신은 PID 제어를 지원하지 않습니다.")
        if not (cap["sv_min"] <= sv <= cap["sv_max"]):
            raise ControlRangeError(
                f"목표 온도는 {cap['sv_min']:.0f}~{cap['sv_max']:.0f}°C 범위여야 합니다."
            )

        gains_cfg = ROASTER_REGISTRY[self._roaster_key]["pid"]
        if self._pid is None:
            self._pid = PidRunner(
                read_pv=self._pv_snapshot,
                write_duty=self._pid_write_duty,
                read_feedback=self._pid_read_feedback,
                gains=PidGains(
                    kp=float(gains_cfg["Kp"]),
                    ki=float(gains_cfg["Ki"]),
                    kd=float(gains_cfg["Kd"]),
                ),
            )
        await self._pid.start(sv)
        if self._pid_task is None or self._pid_task.done():
            # 태스크 참조를 self에 보관해야 GC가 가져가지 않는다 (재연결 태스크와 동일 패턴)
            self._pid_task = asyncio.create_task(self._pid_loop())
        return self._pid.state()

    async def pid_stop(self, mode: str = STOP_HOLD) -> dict[str, Any]:
        if self._pid is None:
            return {"state": "off", "error": None}
        await self._pid.stop("user", mode=mode)
        # 다음 사고는 다시 알릴 수 있게 — 재시도 루프가 끝난 뒤에만 여기 온다
        self._hw_alerts_sent.discard("pid_request_failed")
        return self._pid.state()

    async def pid_set_sv(self, sv: float) -> dict[str, Any]:
        cap = self.pid_capability()
        if self._pid is None:
            raise ControlUnavailable("PID가 실행 중이 아닙니다.")
        if not (cap["sv_min"] <= sv <= cap["sv_max"]):
            raise ControlRangeError(
                f"목표 온도는 {cap['sv_min']:.0f}~{cap['sv_max']:.0f}°C 범위여야 합니다."
            )
        try:
            await self._pid.set_sv(sv)
        except RuntimeError as exc:
            raise ControlUnavailable(str(exc)) from exc
        return self._pid.state()

    async def _pid_loop(self) -> None:
        """고정 주기 제어 루프. 프론트 폴링 주기와 독립이다 — 폴링은 idle에서 멈춘다."""
        try:
            while True:
                await asyncio.sleep(config.PID_TICK_S)
                if self._pid is None:
                    return
                try:
                    await self._pid.tick()
                except Exception as exc:  # 루프는 어떤 경우에도 죽지 않는다
                    _log.error("PID tick 실패: %s", exc, exc_info=True)
        except asyncio.CancelledError:
            raise

    async def enter_standby(self) -> None:
        """UI의 READY 버튼과 연동. 어댑터가 지원하면 standby 진입을 알린다."""
        async with self._lock:
            if (
                self._adapter is not None
                and self._connected
                and hasattr(self._adapter, "enter_standby")
            ):
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
        """배치 계산/PID 상태를 초기화한다. 재연결을 통한 예열 복귀는 가상 머신만 한다."""
        async with self._lock:
            self._ror_window.clear()
            self._et_ror_window.clear()
            self._bt_ema = None
            self._et_ema = None
            self._bt_display_ema = None
            self._et_display_ema = None
            self._ror_warmup = config.ROR_WARMUP_READS
            if self._adapter is None:
                return

            # 히터 0은 쓰기 게이트를 닫기 전에. control()은 _resetting/_connected
            # 이후 거절한다 (#219와 같은 순서).
            if self._pid is not None:
                try:
                    await self._pid.stop("reset", mode=STOP_ZERO)
                except Exception:
                    pass
            if self._pid_task is not None and not self._pid_task.done():
                self._pid_task.cancel()
            self._pid_task = None
            self._pid = None

            # 실제 장비 연결은 배치 경계와 무관하게 유지한다.
            if self._protocol != "virtual":
                return

            self._connection_epoch += 1
            self._last_applied = {}
            self._resetting = True
            self._connected = False
            try:
                try:
                    await self._adapter.disconnect()
                except Exception:
                    pass
                await self._adapter.connect()
                self._connected = True
                self._error = None
                self._consecutive_errors = 0
            except Exception as exc:
                self._connected = False
                self._error = _format_connection_error(
                    exc, self._protocol, self._merged_params
                )
                _log.error("reset 재연결 실패: %s", exc, exc_info=True)
                self._capture_hardware_error(exc, "reset_failed")
                # _refresh_reading은 _connected=False면 재연결을 안 띄운다.
                # 루프는 sleep 후 lock을 잡으므로 여기서 spawn해도 데드락 없음.
                if self._reconnect_task is None or self._reconnect_task.done():
                    self._reconnect_task = asyncio.create_task(self._reconnect_loop())
                raise
            finally:
                self._resetting = False

    def update_settings(self, settings: dict[str, Any]) -> None:
        """프론트엔드 설정 변경을 런타임에 반영."""
        if "ror_window_sec" in settings:
            try:
                v = float(settings["ror_window_sec"])
                # NaN이면 cutoff 비교가 항상 False → deque가 무한 증가한다
                if math.isfinite(v):
                    self._ror_window_secs = max(5.0, min(120.0, v))
            except (TypeError, ValueError):
                pass

    def status(self) -> dict[str, Any]:
        uptime = round(time.monotonic() - self._start_time, 1) if self._connected else 0
        reg = ROASTER_REGISTRY.get(self._roaster_key, {})
        reconnecting = self._reconnect_task is not None and not self._reconnect_task.done()
        return {
            "connected": self._connected,
            "reconnecting": reconnecting,
            "reconnect_attempt": self._reconnect_attempt,
            "roaster": self._roaster_key,
            "display_name": reg.get("display_name", ""),
            "brand": reg.get("brand", ""),
            "capabilities": reg.get("capabilities", []),
            # 제어 능력은 레지스트리 capabilities(표시용)와 다르다 — 실제로 쓸 수 있는
            # role만 담는다. writable=false면 프론트는 제어 UI를 렌더하지 않는다.
            "control": {
                "writable": self._control_writable(),
                "limits": self.write_limits(),
                "pid": self.pid_capability(),
            },
            "uptime": uptime,
            "error": self._error,
        }

    async def probe(self) -> dict[str, Any]:
        """단발 진단 읽기 — EMA/stale 처리를 우회하고 어댑터 원시 값과 소요 시간을 반환.

        실기기에서 Artisan과 값을 직접 비교(A/B)하기 위한 디버깅 전용 경로.
        """
        adapter = self._adapter
        if adapter is None:
            return {"ok": False, "error": "연결된 어댑터 없음"}
        t0 = time.monotonic()
        try:
            r = await adapter.read()
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
        cutoff = ts - self._ror_window_secs
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
        cutoff = ts - self._ror_window_secs
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

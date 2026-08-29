"""
main.py — First Crack sidecar HTTP server
==========================================
aiohttp 기반. Tauri 프론트엔드와 HTTP로 통신.

엔드포인트:
  GET  /roasters      → 지원 로스터 목록 + 프로토콜별 폼 필드
  GET  /serial-ports  → 로컬 시리얼 포트 목록
  GET  /scan-network  → ?protocol=s7|modbus_tcp|kaleido|probat_ws → 열린 host 목록
  GET  /status        → 현재 연결 상태
  POST /connect       → {"roaster": "easyster", "host": "...", ...}
  POST /disconnect
  GET  /temperatures  → {"bt", "et", "ror", "heater", "fan", "timestamp"}
  POST /start         → Charge 버튼 연동: 가상 머신 타이머 리셋 + RoR 윈도우 초기화

어댑터 추가 방법:
  1. adapters/<protocol>.py 에 XxxAdapter 클래스 작성
  2. adapters/__init__.py 의 _PROTOCOL_ADAPTER에 등록
  3. roaster_registry.py 에 항목 추가
"""

# Sentry는 다른 앱 모듈보다 **먼저** 초기화한다 — import 중 터진 예외도 잡히게.
# 활성 조건·release·스크러빙 정책은 모두 sentry_config에 있다.
import sentry_config

sentry_config.init()

import logging
import math
import os
import sys
import time
from typing import Any

from aiohttp import web

import control_guard
import pid_runner
from manager import RoasterManager

from protocol_trace import TRACE
from roaster_registry import ROASTER_REGISTRY, PROTOCOL_FORM_FIELDS

logging.basicConfig(
    level=os.environ.get("SIDECAR_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
_log = logging.getLogger(__name__)


def _pid_alive(pid: int) -> bool:
    """부모 프로세스 생존 여부 확인 (표준 라이브러리만 사용).

    권한 부족은 "죽음"이 아니다. EPERM/ACCESS_DENIED는 프로세스가 존재하지만
    시그널/핸들 권한이 없다는 뜻이므로 True로 판정한다. 오판하면 살아 있는
    부모를 두고 사이드카가 스스로 종료한다 (H9).
    """
    try:
        if sys.platform == "win32":
            import ctypes
            SYNCHRONIZE = 0x00100000
            ERROR_ACCESS_DENIED = 5
            # use_last_error=True + get_last_error(): ctypes가 호출 직후 저장한 에러 코드를
            # 읽는다. windll.kernel32.GetLastError()는 그 사이 다른 호출이 끼면 값이 덮인다.
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True
            return ctypes.get_last_error() == ERROR_ACCESS_DENIED
        else:
            os.kill(pid, 0)
            return True
    except PermissionError:  # OSError 하위 — 반드시 아래 arm보다 먼저 잡아야 한다
        return True
    except (OSError, ProcessLookupError):
        return False


async def _cleanup_manager(manager: RoasterManager) -> None:
    """어댑터 정리(Kaleido CL/AR, 시리얼 해제 등). 실패해도 종료 경로를 막지 않음."""
    try:
        await manager.disconnect()
    except Exception:
        _log.exception("shutdown disconnect failed")


async def parent_watchdog(parent_pid: int, manager: RoasterManager, interval: float = 1.0) -> None:
    """Tauri 부모 프로세스가 죽으면 어댑터 정리 후 sidecar 종료."""
    import asyncio
    while True:
        await asyncio.sleep(interval)
        if not _pid_alive(parent_pid):
            _log.info("부모 프로세스(PID %d) 종료 감지 — sidecar 종료", parent_pid)
            await _cleanup_manager(manager)
            os._exit(0)

class _SilencePolling(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/temperatures" not in msg and "/status" not in msg

logging.getLogger("aiohttp.access").addFilter(_SilencePolling())


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


async def handle_roasters(request: web.Request) -> web.Response:
    INTERNAL_KEYS = {
        "channels",
        "channel_nodes",
        "pid_db",
        "pid_sv_register",
        "modbus_registers",
    }
    result: dict[str, Any] = {}
    for key, reg in ROASTER_REGISTRY.items():
        protocol = reg["protocol"]
        result[key] = {
            "display_name": reg["display_name"],
            "brand": reg["brand"],
            "models": reg["models"],
            "protocol": protocol,
            "capabilities": reg["capabilities"],
            "pid": reg.get("pid"),
            "form_fields": PROTOCOL_FORM_FIELDS.get(protocol, []),
            "default_params": {
                k: v for k, v in reg["default_params"].items() if k not in INTERNAL_KEYS
            },
        }
    return web.json_response(result)


async def handle_status(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    return web.json_response(manager.status())


async def handle_connect(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    roaster_key = body.pop("roaster", None)
    if not roaster_key:
        return web.json_response({"error": "roaster field required"}, status=400)
    try:
        await manager.connect(roaster_key, body)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    return web.json_response(manager.status())


async def handle_disconnect(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    await manager.disconnect()
    return web.json_response(manager.status())


async def handle_temperatures(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    data = await manager.read_temperatures()
    # PID 런타임 상태는 여기 실어 보낸다 — 프론트는 이미 이 엔드포인트를 폴링 중이라
    # 별도 타이머가 필요 없다. (정적 지원 여부는 /status.control.pid)
    pid_state = manager.pid_state()
    if pid_state is not None:
        data = {**data, "pid": pid_state}
    return web.json_response(data)


async def handle_standby(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    await manager.enter_standby()
    return web.json_response({"ok": True})


async def handle_start(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    await manager.start_roast()
    return web.json_response({"ok": True})


async def handle_reset(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    try:
        await manager.reset_roast()
    except Exception as exc:
        _log.error("reset 실패: %s", exc, exc_info=True)
        body = manager.status()
        body["ok"] = False
        return web.json_response(body, status=500)
    return web.json_response({"ok": True})


async def handle_settings(request: web.Request) -> web.Response:
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    manager: RoasterManager = request.app["manager"]
    manager.update_settings(body)
    return web.json_response({"ok": True})



async def handle_shutdown(request: web.Request) -> web.Response:
    """Tauri Exit 핸들러에서 호출하는 graceful shutdown 엔드포인트."""
    import asyncio

    manager: RoasterManager = request.app["manager"]
    await _cleanup_manager(manager)
    # 응답 flush 후 프로세스 종료
    asyncio.get_event_loop().call_later(0.05, os._exit, 0)
    return web.Response(text="ok")


async def handle_control(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    manager: RoasterManager = request.app["manager"]
    try:
        # 빈 요청은 연결 여부와 무관하게 no-op — 검증은 쓸 값이 있을 때만 의미가 있다.
        cmd = control_guard.parse_command(body)
        if not cmd:
            return web.json_response({"ok": True, "applied": {}})
        applied = await manager.control(**cmd)
    except control_guard.ControlRangeError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except control_guard.ControlUnavailable as exc:
        return web.json_response({"error": str(exc)}, status=409)
    except Exception as exc:
        _log.error("control 실패: %s", exc, exc_info=True)
        # 400/409는 클라이언트 문제 — PLC 쓰기 실패(502)만 관측한다 (#269)
        manager._capture_hardware_error(exc, "control_write_failed")
        return web.json_response({"error": "제어 명령 전송에 실패했습니다."}, status=502)
    return web.json_response({"ok": True, "applied": applied})


def _pid_error_response(
    exc: Exception, manager: RoasterManager, *, once: bool = False
) -> web.Response:
    if isinstance(exc, control_guard.ControlRangeError):
        return web.json_response({"error": str(exc)}, status=400)
    if isinstance(exc, control_guard.ControlUnavailable):
        return web.json_response({"error": str(exc)}, status=409)
    _log.error("PID 요청 실패: %s", exc, exc_info=True)
    # safe-off 쓰기 실패 포함 — 배출 후 버너가 안 꺼진 경로가 여기로 온다 (#269)
    # /pid/off 재시도는 once=True — 같은 사고를 5초마다 Slack/Sentry에 안 쌓는다
    manager._capture_hardware_error(exc, "pid_request_failed", once=once)
    return web.json_response({"error": "PID 명령을 처리하지 못했습니다."}, status=502)


def _parse_sv(body: Any) -> float:
    # JSON 배열/문자열/숫자가 오면 body.get이 AttributeError → 502가 된다.
    # 잘못 보낸 쪽은 클라이언트이므로 400이 맞다.
    if not isinstance(body, dict):
        raise control_guard.ControlRangeError("요청 형식이 올바르지 않습니다.")
    raw = body.get("sv")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise control_guard.ControlRangeError("목표 온도(sv)가 숫자가 아닙니다.")
    try:
        sv = float(raw)
    except (TypeError, ValueError):
        raise control_guard.ControlRangeError("목표 온도(sv)가 숫자가 아닙니다.") from None
    if not math.isfinite(sv):
        raise control_guard.ControlRangeError("목표 온도(sv)가 유효하지 않습니다.")
    return sv


async def handle_pid_on(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    manager: RoasterManager = request.app["manager"]
    try:
        state = await manager.pid_start(_parse_sv(body))
    except Exception as exc:
        return _pid_error_response(exc, manager)
    return web.json_response({"ok": True, "pid": state})


async def handle_pid_off(request: web.Request) -> web.Response:
    # 바디는 선택 — 없으면 hold(현재 화력 유지)
    try:
        body = await request.json()
    except Exception:
        body = {}
    mode = body.get("mode") if isinstance(body, dict) else None
    if mode not in (pid_runner.STOP_HOLD, pid_runner.STOP_ZERO, None):
        return web.json_response({"error": f"알 수 없는 mode: {mode}"}, status=400)
    manager: RoasterManager = request.app["manager"]
    try:
        state = await manager.pid_stop(mode or pid_runner.STOP_HOLD)
    except Exception as exc:
        return _pid_error_response(exc, manager, once=True)
    return web.json_response({"ok": True, "pid": state})


async def handle_pid_sv(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    manager: RoasterManager = request.app["manager"]
    try:
        state = await manager.pid_set_sv(_parse_sv(body))
    except Exception as exc:
        return _pid_error_response(exc, manager)
    return web.json_response({"ok": True, "pid": state})


def _is_na(s: str) -> bool:
    return not s or s.lower() == "n/a"


async def handle_serial_ports(request: web.Request) -> web.Response:
    try:
        import serial.tools.list_ports  # type: ignore[import]

        ports = []
        for p in serial.tools.list_ports.comports():
            hwid = (p.hwid or "").strip()
            desc = (p.description or "").strip()
            if _is_na(hwid) and _is_na(desc):  # Bluetooth 가상 포트 제외
                continue
            ports.append(
                {
                    "device": p.device,
                    "description": desc if not _is_na(desc) else p.device,
                }
            )
    except Exception:  # ImportError + OS 열거 실패(Windows 레지스트리 등)
        _log.warning("포트 열거 실패", exc_info=True)
        ports = []
    return web.json_response(ports)


async def handle_scan_network(request: web.Request) -> web.Response:
    """TCP connect scan on protocol default port (same /24). Soft-fails to []."""
    from scanner import scan_protocol

    protocol = (request.rel_url.query.get("protocol") or "").strip()
    if not protocol:
        return web.json_response({"error": "protocol query required"}, status=400)
    try:
        hosts = await scan_protocol(protocol)
    except ValueError:
        return web.json_response({"error": "unknown protocol"}, status=400)
    return web.json_response(hosts)

async def handle_debug_trace_get(request: web.Request) -> web.Response:
    entries = TRACE.dump()
    return web.json_response(
        {"enabled": TRACE.enabled, "count": len(entries), "entries": entries}
    )


async def handle_debug_trace_post(request: web.Request) -> web.Response:
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    if "enabled" in body:
        TRACE.enabled = bool(body["enabled"])
        _log.info("프로토콜 트레이스 %s", "ON" if TRACE.enabled else "OFF")
    if body.get("clear"):
        TRACE.clear()
    return web.json_response({"enabled": TRACE.enabled})


async def handle_debug_probe(request: web.Request) -> web.Response:
    """단발 원시 읽기 + 그 동안의 트레이스. Artisan A/B 비교용.

    probe 중 트레이스를 일시 활성화한다. probe 완료 후 트레이스 상태는 probe 시점의
    활성화 여부로 복원된다 (best-effort — 동시 /debug/trace POST 요청이 있으면 그 값이 우선).
    finally 블록을 쓰지 않는 이유: probe 예외를 숨기지 않기 위해 직접 복원한다.
    """
    manager: RoasterManager = request.app["manager"]
    prev_enabled = TRACE.enabled
    TRACE.enabled = True
    t0 = round(time.monotonic(), 4)
    result = await manager.probe()
    TRACE.enabled = prev_enabled  # best-effort restore; concurrent /debug/trace POST takes precedence
    result["trace"] = [e for e in TRACE.dump() if e["ts"] >= t0]
    return web.json_response(result)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


# Tauri 프론트엔드가 사용하는 origin 목록.
# macOS 번들: "tauri://localhost", Windows 번들: "http://tauri.localhost",
# dev(Vite): "http://localhost:1420"
_ALLOWED_ORIGINS = frozenset({
    "tauri://localhost",
    "http://tauri.localhost",
    "http://localhost:1420",
})


TOKEN_HEADER = "X-Sidecar-Token"


@web.middleware
async def cors_middleware(request: web.Request, handler: Any) -> web.Response:
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        resp = await handler(request)

    origin = request.headers.get("Origin", "")
    if origin in _ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        # Chromium의 Private Network Access(LNA) 정책 대응 — preflight에서 요구됨
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = f"Content-Type, {TOKEN_HEADER}"
    return resp


def _make_token_middleware(expected: str) -> Any:
    """X-Sidecar-Token 검증 미들웨어.

    127.0.0.1:9999는 다른 로컬 프로세스·브라우저(Safari/Firefox)에서도 접근 가능해
    /shutdown·/disconnect가 로컬 CSRF 벡터가 된다. Tauri가 spawn 시 env로 넘긴
    토큰을 요구해 이를 막는다.

    - OPTIONS는 통과: 브라우저 preflight에는 커스텀 헤더가 실리지 않는다.
    - 401은 raise가 아니라 반환한다 — 바깥 cors_middleware가 헤더를 붙일 수 있어야 한다.
    """

    @web.middleware
    async def token_middleware(request: web.Request, handler: Any) -> web.Response:
        if request.method == "OPTIONS":
            return await handler(request)
        if request.headers.get(TOKEN_HEADER) != expected:
            _log.warning("토큰 불일치 요청 거부: %s %s", request.method, request.path)
            return web.json_response({"error": "unauthorized"}, status=401)
        return await handler(request)

    return token_middleware


def create_app() -> web.Application:
    middlewares = [cors_middleware]
    # 토큰은 Tauri가 spawn 시 주입한다. env가 없으면(venv 직접 실행 dev) 검증을 건너뛴다.
    token = os.environ.get("SIDECAR_TOKEN")
    if token:
        middlewares.append(_make_token_middleware(token))
    else:
        _log.info("SIDECAR_TOKEN 미설정 — HTTP 토큰 인증 비활성 (dev 모드)")

    app = web.Application(middlewares=middlewares)
    app["manager"] = RoasterManager()

    async def _start_watchdog(app: web.Application) -> None:
        import asyncio
        pid_str = os.environ.get("SIDECAR_PARENT_PID")
        if pid_str:
            # 강참조 보관 — 로컬 변수로 두면 GC가 태스크를 수거할 수 있다 (H9)
            app["watchdog_task"] = asyncio.create_task(
                parent_watchdog(int(pid_str), app["manager"])
            )

    async def _cleanup_on_app_exit(app: web.Application) -> None:
        import asyncio
        task = app.get("watchdog_task")
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await _cleanup_manager(app["manager"])

    app.on_startup.append(_start_watchdog)
    app.on_cleanup.append(_cleanup_on_app_exit)

    # 클라이언트는 src/entities/machine/roasterRegistry.ts (정적 복사본)를 사용.
    # GET /roasters는 현재 호출되지 않음 — 향후 단일화 시 활성화.
    app.router.add_get("/roasters", handle_roasters)
    app.router.add_get("/serial-ports", handle_serial_ports)
    app.router.add_get("/scan-network", handle_scan_network)
    app.router.add_get("/status", handle_status)
    app.router.add_post("/connect", handle_connect)
    app.router.add_post("/disconnect", handle_disconnect)
    app.router.add_get("/temperatures", handle_temperatures)
    app.router.add_post("/standby", handle_standby)
    app.router.add_post("/start", handle_start)
    app.router.add_post("/reset", handle_reset)
    app.router.add_post("/settings", handle_settings)
    app.router.add_post("/control", handle_control)
    app.router.add_post("/pid/on", handle_pid_on)
    app.router.add_post("/pid/off", handle_pid_off)
    app.router.add_post("/pid/sv", handle_pid_sv)
    app.router.add_get("/debug/trace", handle_debug_trace_get)
    app.router.add_post("/debug/trace", handle_debug_trace_post)
    app.router.add_get("/debug/probe", handle_debug_probe)
    app.router.add_post("/shutdown", handle_shutdown)
    app.router.add_route("OPTIONS", "/{path_info:.*}", lambda r: web.Response())
    return app


if __name__ == "__main__":
    _log.info("First Crack sidecar 시작 — http://127.0.0.1:9999")
    web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)

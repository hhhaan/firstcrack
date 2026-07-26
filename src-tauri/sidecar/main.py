"""
main.py — First Crack sidecar HTTP server
==========================================
aiohttp 기반. Tauri 프론트엔드와 HTTP로 통신.

엔드포인트:
  GET  /roasters      → 지원 로스터 목록 + 프로토콜별 폼 필드
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

import logging
import os
import sys
import time
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.aiohttp import AioHttpIntegration
from aiohttp import web

from manager import RoasterManager

from protocol_trace import TRACE
from roaster_registry import ROASTER_REGISTRY, PROTOCOL_FORM_FIELDS

# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------
_SENTRY_DSN = (
    "https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944"
)

if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment="production",
        release=os.environ.get("SIDECAR_VERSION", "unknown"),
        traces_sample_rate=0.1,
        integrations=[AioHttpIntegration()],
        send_default_pii=False,
    )

logging.basicConfig(
    level=os.environ.get("SIDECAR_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
_log = logging.getLogger(__name__)


def _pid_alive(pid: int) -> bool:
    """부모 프로세스 생존 여부 확인 (표준 라이브러리만 사용)."""
    try:
        if sys.platform == "win32":
            import ctypes
            SYNCHRONIZE = 0x00100000
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        else:
            os.kill(pid, 0)
            return True
    except (OSError, ProcessLookupError):
        return False


async def _cleanup_manager(manager: RoasterManager) -> None:
    """어댑터 정리(Kaleido CL/AR, 시리얼 해제 등). 실패해도 종료 경로를 막지 않음."""
    try:
        await manager.disconnect()
    except Exception:
        _log.exception("shutdown disconnect failed")


async def parent_watchdog(parent_pid: int, manager: RoasterManager) -> None:
    """Tauri 부모 프로세스가 죽으면 어댑터 정리 후 sidecar 종료."""
    import asyncio
    while True:
        await asyncio.sleep(1.0)
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
    await manager.reset_roast()
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
    await manager.control(
        heater=body.get("heater"),
        fan=body.get("fan"),
        drum=body.get("drum"),
    )
    return web.json_response({"ok": True})


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
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["manager"] = RoasterManager()

    async def _start_watchdog(app: web.Application) -> None:
        import asyncio
        pid_str = os.environ.get("SIDECAR_PARENT_PID")
        if pid_str:
            asyncio.create_task(parent_watchdog(int(pid_str), app["manager"]))

    async def _cleanup_on_app_exit(app: web.Application) -> None:
        await _cleanup_manager(app["manager"])

    app.on_startup.append(_start_watchdog)
    app.on_cleanup.append(_cleanup_on_app_exit)

    # 클라이언트는 src/entities/machine/roasterRegistry.ts (정적 복사본)를 사용.
    # GET /roasters는 현재 호출되지 않음 — 향후 단일화 시 활성화.
    app.router.add_get("/roasters", handle_roasters)
    app.router.add_get("/serial-ports", handle_serial_ports)
    app.router.add_get("/status", handle_status)
    app.router.add_post("/connect", handle_connect)
    app.router.add_post("/disconnect", handle_disconnect)
    app.router.add_get("/temperatures", handle_temperatures)
    app.router.add_post("/standby", handle_standby)
    app.router.add_post("/start", handle_start)
    app.router.add_post("/reset", handle_reset)
    app.router.add_post("/settings", handle_settings)
    app.router.add_post("/control", handle_control)
    app.router.add_get("/debug/trace", handle_debug_trace_get)
    app.router.add_post("/debug/trace", handle_debug_trace_post)
    app.router.add_get("/debug/probe", handle_debug_probe)
    app.router.add_post("/shutdown", handle_shutdown)
    app.router.add_route("OPTIONS", "/{path_info:.*}", lambda r: web.Response())
    return app


if __name__ == "__main__":
    _log.info("First Crack sidecar 시작 — http://127.0.0.1:9999")
    web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)

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
import time
from typing import Any

from aiohttp import web

from manager import RoasterManager
from protocol_trace import TRACE
from roaster_registry import ROASTER_REGISTRY, PROTOCOL_FORM_FIELDS

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger(__name__)

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
    except ImportError:
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
    """단발 원시 읽기 + 그 동안의 트레이스. Artisan A/B 비교용."""
    manager: RoasterManager = request.app["manager"]
    prev_enabled = TRACE.enabled
    TRACE.enabled = True
    t0 = round(time.monotonic(), 4)
    try:
        result = await manager.probe()
    finally:
        TRACE.enabled = prev_enabled
    result["trace"] = [e for e in TRACE.dump() if e["ts"] >= t0]
    return web.json_response(result)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


@web.middleware
async def cors_middleware(request: web.Request, handler: Any) -> web.Response:
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        resp = await handler(request)
    # TODO (T8): 프로덕션에서는 "tauri://localhost" 로 제한 필요.
    # dev: "http://localhost:1420", prod: "tauri://localhost"
    # Tauri sidecar 번들링 완료 후 실제 origin 확인 뒤 교체.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["manager"] = RoasterManager()
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
    app.router.add_get("/debug/trace", handle_debug_trace_get)
    app.router.add_post("/debug/trace", handle_debug_trace_post)
    app.router.add_get("/debug/probe", handle_debug_probe)
    app.router.add_route("OPTIONS", "/{path_info:.*}", lambda r: web.Response())
    return app


if __name__ == "__main__":
    _log.info("First Crack sidecar 시작 — http://127.0.0.1:9999")
    web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)

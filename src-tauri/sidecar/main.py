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
  POST /start         → Charge 버튼 연동: 시뮬레이터 타이머 리셋 + RoR 윈도우 초기화
  POST /control       → {"heater"?, "fan"?, "drum"?}

어댑터 추가 방법:
  1. adapters/<protocol>.py 에 XxxAdapter 클래스 작성
  2. adapters/__init__.py 의 _PROTOCOL_ADAPTER에 등록
  3. roaster_registry.py 에 항목 추가
"""

import logging
from typing import Any

from aiohttp import web

from manager import RoasterManager
from roaster_registry import ROASTER_REGISTRY, PROTOCOL_FORM_FIELDS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

async def handle_roasters(request: web.Request) -> web.Response:
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
                k: v for k, v in reg["default_params"].items()
                if k not in ("channels", "channel_nodes", "pid_db", "pid_sv_register", "modbus_registers")
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


async def handle_start(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    await manager.start_roast()
    return web.json_response({"ok": True})


async def handle_control(request: web.Request) -> web.Response:
    manager: RoasterManager = request.app["manager"]
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    await manager.send_control(
        heater=body.get("heater"),
        fan=body.get("fan"),
        drum=body.get("drum"),
    )
    return web.json_response({"ok": True})


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

@web.middleware
async def cors_middleware(request: web.Request, handler: Any) -> web.Response:
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


async def on_startup(app: web.Application) -> None:
    """시작 시 Simulator 자동 연결 (개발용)."""
    manager: RoasterManager = app["manager"]
    await manager.connect("simulator", {})
    _log.info("Simulator 자동 연결 완료")


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["manager"] = RoasterManager()
    app.on_startup.append(on_startup)
    app.router.add_get("/roasters",     handle_roasters)
    app.router.add_get("/status",       handle_status)
    app.router.add_post("/connect",     handle_connect)
    app.router.add_post("/disconnect",  handle_disconnect)
    app.router.add_get("/temperatures", handle_temperatures)
    app.router.add_post("/start",        handle_start)
    app.router.add_post("/control",     handle_control)
    app.router.add_route("OPTIONS", "/{path_info:.*}", lambda r: web.Response())
    return app


if __name__ == "__main__":
    _log.info("First Crack sidecar 시작 — http://127.0.0.1:9999")
    web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)

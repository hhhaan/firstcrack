"""Owned virtual-only sidecar for real-app FSD verification; never binds 9999."""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import logging
import os
from pathlib import Path
import secrets
import sys
import time


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.repo.resolve()
    spec = importlib.util.spec_from_file_location("fsd_app_driver", root / "scripts/verify-fsd-curve.py")
    curve = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = curve
    spec.loader.exec_module(curve)
    web = curve.live.web
    reference = await curve.recorded_reference(180)
    logs = []
    original_create_app = curve.live.sidecar_main.create_app

    @web.middleware
    async def observe(request, handler):
        started = time.monotonic()
        body = await request.json() if request.can_read_body else None
        response = await handler(request)
        logs.append({"path": request.path_qs, "method": request.method, "request": body,
                     "status": response.status, "started_at": started,
                     "completed_at": time.monotonic(),
                     "response": json.loads(response.body) if response.body else None})
        return response

    def create_app():
        app = original_create_app()
        app.middlewares.insert(0, observe)
        return app

    curve.live.sidecar_main.create_app = create_app
    fixture_token = secrets.token_urlsafe(32)
    logger = logging.getLogger("fsd-app-fixture")
    logger.addHandler(logging.NullHandler())
    driver = curve.live.LiveDriver(logger)
    async with driver:
        curve.live.sidecar_main.create_app = original_create_app

        async def reset():
            await driver.fresh_connect()
            assert driver.adapter._model is not None
            driver.adapter._model.bt = 180
            driver.adapter._model_ts = time.monotonic()
            await driver.request("/control", {"heater": 0, "origin": "manual"})

        await reset()

        @web.middleware
        async def guard(request, handler):
            if request.headers.get("X-Fixture-Token") != fixture_token:
                return web.json_response({"error": "invalid fixture token"}, status=403)
            return await handler(request)

        async def state(_request):
            status = await driver.request("/status")
            return web.json_response({"status": status.body, "writes": driver.adapter.writes,
                                      "requests": logs, "source_hashes": curve.source_hashes()})

        async def inject(request):
            payload = await request.json()
            action = payload.get("action")
            if action == "reset":
                await reset()
            elif action == "initial_bt":
                assert driver.manager._heat._charge is None
                assert driver.adapter._model is not None
                driver.adapter._model.bt = 180
                driver.adapter._model_ts = time.monotonic()
            elif action == "block_write":
                driver.adapter.gate_next_write()
            elif action == "block_read":
                driver.adapter.gate_next_read()
            elif action == "release":
                driver.adapter.release_gates()
            elif action == "fail_minimum":
                driver.adapter.fail_zero_writes = 1
            else:
                return web.json_response({"error": "unknown virtual injection"}, status=400)
            return web.json_response({"ok": True})

        app = web.Application(middlewares=[guard])
        app.router.add_get("/state", state)
        app.router.add_post("/inject", inject)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        listener = curve.live.socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        port = listener.getsockname()[1]
        assert port != 9999 and driver.port != 9999
        await web.SockSite(runner, listener).start()
        print(json.dumps({"sidecar": driver.base_url, "token": os.environ["SIDECAR_TOKEN"],
                          "fixture": f"http://127.0.0.1:{port}", "fixture_token": fixture_token,
                          "reference": reference, "pid": os.getpid()}), flush=True)
        try:
            while await asyncio.to_thread(sys.stdin.readline):
                break
        finally:
            await runner.cleanup()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"requests": logs, "writes": [a.writes for a in driver.adapters],
                                       "cleanup": driver.cleanup, "source_hashes": curve.source_hashes()}, indent=2))
    assert not any(driver.cleanup.values()), driver.cleanup


if __name__ == "__main__":
    asyncio.run(main())

"""
market_data.py — 외부 시장 데이터 프록시

Coffee C 선물 가격을 yfinance로 조회하고 30초간 캐시한다.
SRP: 변경 이유는 데이터 소스/캐시 전략 변경 한 가지.
"""

import logging
from typing import Any

from aiohttp import web
from aiohttp.web_request import Request

_log = logging.getLogger(__name__)

_CACHE_ATTR = "coffee_futures_cache"


async def handle_coffee_futures(request: Request) -> web.Response:
    import asyncio
    import time

    cache: dict[str, Any] | None = request.app.get(_CACHE_ATTR)
    if cache is None:
        cache = {"ts": 0.0, "data": None}
        request.app[_CACHE_ATTR] = cache

    now = time.monotonic()
    if cache["data"] is not None and now - cache["ts"] < 30:
        return web.json_response(cache["data"])

    try:
        import yfinance as yf  # type: ignore[import-untyped]

        ticker = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, lambda: yf.Ticker("KC=F")),
            timeout=5,
        )
        info = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, lambda: ticker.info),
            timeout=5,
        )
        price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
        if (
            price is None
            or prev_close is None
            or not isinstance(price, (int, float))
            or not isinstance(prev_close, (int, float))
        ):
            return web.json_response({"error": "incomplete data from yfinance"}, status=502)
        payload = {"price": price, "previousClose": prev_close}
        cache["data"] = payload
        cache["ts"] = time.monotonic()
        return web.json_response(payload)
    except Exception:
        _log.exception("Failed to fetch coffee futures data")
        return web.json_response({"error": "failed to fetch coffee futures data"}, status=502)

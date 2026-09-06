"""로스트 세션 TSV 기록 — webview 타이머와 독립인 sidecar tick.

프론트 `tsv-writer`와 바이트 호환: 헤더 `time\\tbt\\tet\\tror\\theater\\tfan\\tdrum`,
time은 소수점 2자리, charge 이후 행만 기록. pre-charge/BBP는 프론트 잔류.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import config
from bt_filter import create_bt_filter

_log = logging.getLogger(__name__)

TSV_HEADER = "time\tbt\tet\tror\theater\tfan\tdrum\n"

ReadFn = Callable[..., Awaitable[dict[str, Any]]]


def parse_session_id(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("session_id must be a UUID string")
    try:
        return str(uuid.UUID(value.strip()))
    except (ValueError, AttributeError) as exc:
        raise ValueError("session_id must be a UUID string") from exc


def parse_charge_epoch_ms(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("charge_epoch_ms must be a unix epoch in milliseconds")
    if not math.isfinite(value) or value <= 0:
        raise ValueError("charge_epoch_ms must be a unix epoch in milliseconds")
    return float(value)


def resolve_tsv_path(session_id: str, path: Any | None) -> Path:
    if path is None or path == "":
        data_dir = os.environ.get("SIDECAR_DATA_DIR")
        if not data_dir:
            raise ValueError("path required (SIDECAR_DATA_DIR unset)")
        path = str(Path(data_dir) / f"session_{session_id}.tsv")
    if not isinstance(path, str):
        raise ValueError("path must be an absolute file path")
    p = Path(path)
    if not p.is_absolute():
        raise ValueError("path must be absolute")
    expected = f"session_{session_id}.tsv"
    if p.name != expected:
        raise ValueError(f"path must be named {expected}")
    resolved = p.resolve()
    if resolved.name != expected:
        raise ValueError(f"path must be named {expected}")
    return resolved


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        if value == math.trunc(value):
            return str(int(value))
        return str(value)
    return str(value)


def format_row(
    t: float,
    bt: float,
    et: Any,
    ror: Any,
    heater: Any,
    fan: Any,
    drum: Any,
) -> str:
    return (
        f"{t:.2f}\t{_cell(bt)}\t{_cell(et)}\t{_cell(ror)}\t"
        f"{_cell(heater)}\t{_cell(fan if fan is not None else 0)}\t"
        f"{_cell(drum if drum is not None else 0)}\n"
    )


class SessionRecorder:
    def __init__(
        self,
        *,
        session_id: str,
        path: Path,
        charge_epoch_ms: float,
        read_fn: ReadFn,
        interval_s: float | None = None,
        max_age_s: float | None = None,
    ) -> None:
        self.session_id = session_id
        self.path = path
        self.charge_epoch_ms = charge_epoch_ms
        self._read_fn = read_fn
        self._interval_s = config.RECORD_TICK_S if interval_s is None else interval_s
        self._max_age_s = config.READING_MAX_AGE_S if max_age_s is None else max_age_s
        self._filter = create_bt_filter()
        self._fh: Any = None
        self._task: asyncio.Task[None] | None = None

    def snapshot(self) -> dict[str, str]:
        return {"session_id": self.session_id, "path": str(self.path)}

    async def start(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        exists = self.path.exists()
        size = self.path.stat().st_size if exists else 0
        self._fh = self.path.open("a", encoding="utf-8", newline="\n")
        if size == 0:
            self._fh.write(TSV_HEADER)
            self._fh.flush()
        self._task = asyncio.create_task(self._loop(), name=f"session-recorder:{self.session_id}")

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._close()

    def _close(self) -> None:
        fh = self._fh
        self._fh = None
        if fh is None:
            return
        try:
            fh.flush()
            fh.close()
        except Exception:
            _log.exception("session recorder close failed [%s]", self.session_id)

    async def _loop(self) -> None:
        try:
            while True:
                try:
                    await self._tick()
                except Exception:
                    _log.exception("session recorder tick failed [%s]", self.session_id)
                await asyncio.sleep(self._interval_s)
        except asyncio.CancelledError:
            raise

    async def _tick(self) -> None:
        if self._fh is None:
            return
        try:
            payload = await self._read_fn(max_age=self._max_age_s)
        except Exception:
            _log.exception("session recorder read failed [%s]", self.session_id)
            return
        bt_raw = payload.get("bt")
        if bt_raw is None:
            return
        try:
            bt = float(bt_raw)
        except (TypeError, ValueError):
            return
        now_ms = time.time() * 1000.0
        filtered = self._filter(bt, now_ms)
        if filtered is None:
            return
        t = (now_ms - self.charge_epoch_ms) / 1000.0
        if t < 0:
            return
        self._fh.write(
            format_row(
                t,
                filtered,
                payload.get("et"),
                payload.get("ror"),
                payload.get("heater"),
                payload.get("fan"),
                payload.get("drum"),
            )
        )
        self._fh.flush()

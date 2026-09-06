"""Session TSV recorder — header, rows, resume, glitch skip, path guard."""

import asyncio
import time
from pathlib import Path

import pytest

from session_recorder import (
    SessionRecorder,
    TSV_HEADER,
    format_row,
    parse_session_id,
    resolve_tsv_path,
)

SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


def test_format_row_matches_frontend_tsv():
    assert format_row(1.5, 200.0, 210.0, 5.0, 80.0, 40.0, 60.0) == "1.50\t200\t210\t5\t80\t40\t60\n"
    assert format_row(0.0, 180.0, None, None, None, 0, 0) == "0.00\t180\t\t\t\t0\t0\n"


def test_parse_session_id_rejects_junk():
    assert parse_session_id(SESSION) == SESSION
    with pytest.raises(ValueError):
        parse_session_id("../etc/passwd")
    with pytest.raises(ValueError):
        parse_session_id(123)


def test_resolve_tsv_path_requires_matching_name(tmp_path: Path):
    good = tmp_path / f"session_{SESSION}.tsv"
    assert resolve_tsv_path(SESSION, str(good)) == good.resolve()
    with pytest.raises(ValueError, match="absolute"):
        resolve_tsv_path(SESSION, f"session_{SESSION}.tsv")
    with pytest.raises(ValueError, match="named"):
        resolve_tsv_path(SESSION, str(tmp_path / "other.tsv"))


class _RepeatingRead:
    def __init__(self, payload: dict, calls: list):
        self.payload = payload
        self.calls = calls

    async def __call__(self, max_age: float = 0.0) -> dict:
        self.calls.append(max_age)
        return self.payload


async def _wait_rows(path: Path, n: int, timeout: float = 2.0) -> list[str]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            lines = path.read_text(encoding="utf-8").splitlines()
            if len(lines) >= n + 1:  # header + n
                return lines
        await asyncio.sleep(0.02)
    raise AssertionError(f"expected {n} data rows in {path}")


@pytest.mark.asyncio
async def test_recorder_writes_header_and_rows(tmp_path: Path):
    path = tmp_path / f"session_{SESSION}.tsv"
    calls: list[float] = []
    rec = SessionRecorder(
        session_id=SESSION,
        path=path,
        charge_epoch_ms=time.time() * 1000 - 1500,
        read_fn=_RepeatingRead(
            {"bt": 200.0, "et": 210.0, "ror": 5.0, "heater": 80, "fan": 40, "drum": 60},
            calls,
        ),
        interval_s=0.05,
        max_age_s=1.5,
    )
    await rec.start()
    try:
        lines = await _wait_rows(path, 2)
        assert lines[0] == TSV_HEADER.rstrip("\n")
        assert lines[1].endswith("\t80\t40\t60")
        assert calls and calls[0] == 1.5
    finally:
        await rec.stop()


@pytest.mark.asyncio
async def test_recorder_resume_appends_without_new_header(tmp_path: Path):
    path = tmp_path / f"session_{SESSION}.tsv"
    path.write_text(TSV_HEADER + "0.50\t180\t200\t1\t10\t20\t30\n", encoding="utf-8")
    rec = SessionRecorder(
        session_id=SESSION,
        path=path,
        charge_epoch_ms=time.time() * 1000,
        read_fn=_RepeatingRead(
            {"bt": 190.0, "et": 205.0, "ror": 2.0, "heater": 50, "fan": 30, "drum": 40},
            [],
        ),
        interval_s=0.05,
    )
    await rec.start()
    try:
        lines = await _wait_rows(path, 2)
        assert lines[0] == TSV_HEADER.rstrip("\n")
        assert lines[1] == "0.50\t180\t200\t1\t10\t20\t30"
        assert sum(1 for line in lines if line.startswith("time")) == 1
    finally:
        await rec.stop()


@pytest.mark.asyncio
async def test_recorder_skips_glitch_bt(tmp_path: Path):
    path = tmp_path / f"session_{SESSION}.tsv"

    class SpikeThenRecover:
        def __init__(self):
            self.n = 0

        async def __call__(self, max_age: float = 0.0) -> dict:
            self.n += 1
            bt = 120.0 if self.n == 2 else 190.0
            return {"bt": bt, "et": 200.0, "ror": 1.0, "heater": 40, "fan": 20, "drum": 30}

    rec = SessionRecorder(
        session_id=SESSION,
        path=path,
        charge_epoch_ms=time.time() * 1000,
        read_fn=SpikeThenRecover(),
        interval_s=0.05,
    )
    await rec.start()
    try:
        deadline = time.monotonic() + 2.0
        body = []
        while time.monotonic() < deadline:
            if path.exists():
                body = [ln for ln in path.read_text(encoding="utf-8").splitlines() if not ln.startswith("time")]
                if any("\t120\t" in ln for ln in body):
                    break
                if len(body) >= 2:
                    break
            await asyncio.sleep(0.02)
        assert body
        assert all("\t120\t" not in ln for ln in body)
    finally:
        await rec.stop()

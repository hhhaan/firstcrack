#!/usr/bin/env python3
"""Run isolated FSD live scenarios against a private virtual sidecar."""

from __future__ import annotations

import argparse
import asyncio
import copy
import dataclasses
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import secrets
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Any, Awaitable


REPO = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE = Path(tempfile.gettempdir()) / "first-crack-fsd" / "01"
SIDECAR = REPO / "src-tauri" / "sidecar"

os.environ["SIDECAR_DISABLE_SENTRY"] = "1"
os.environ.pop("SIDECAR_PARENT_PID", None)
os.environ["SIDECAR_TOKEN"] = secrets.token_urlsafe(32)
sys.path.insert(0, str(SIDECAR))

from aiohttp import ClientSession, ClientTimeout, web
from adapters.base import Reading
from adapters.virtual import VirtualMachineAdapter
import config
import main as sidecar_main
import manager as manager_module


JSON = dict[str, Any]


@dataclasses.dataclass
class HttpOutcome:
    method: str
    path: str
    status: int
    body: Any
    elapsed_ms: float
    started_at: float
    completed_at: float
    payload: Any

    def json(self) -> JSON:
        return dataclasses.asdict(self)


class ControlledVirtualAdapter(VirtualMachineAdapter):
    """Virtual adapter with process-local observation and delay/failure gates."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.writes: list[JSON] = []
        self.reads: list[JSON] = []
        self.block_next_read = False
        self.block_next_write = False
        self.fail_reads = 0
        self.fail_zero_writes = 0
        self.invalid_reads: list[str] = []
        self.last_reading: Reading | None = None
        self.frozen_reading: Reading | None = None
        self.buffer_next_read = False
        self.read_gate = asyncio.Event()
        self.write_gate = asyncio.Event()
        self.read_started = asyncio.Event()
        self.write_started = asyncio.Event()
        self.read_gate.set()
        self.write_gate.set()

    def gate_next_read(self, *, after_acquisition: bool = False) -> None:
        self.block_next_read = True
        self.buffer_next_read = after_acquisition
        self.read_gate.clear()
        self.read_started.clear()

    def gate_next_write(self) -> None:
        self.block_next_write = True
        self.write_gate.clear()
        self.write_started.clear()

    def release_gates(self) -> None:
        self.read_gate.set()
        self.write_gate.set()

    async def read(self):
        event = {"phase": "started", "at": time.monotonic()}
        self.reads.append(event)
        try:
            reading = None
            if self.block_next_read:
                self.block_next_read = False
                if self.buffer_next_read:
                    self.buffer_next_read = False
                    reading = await super().read()
                    event.update(buffered=True, acquired_at=reading.timestamp, acquired_bt=reading.bt)
                event["gated"] = True
                self.read_started.set()
                await self.read_gate.wait()
            if self.fail_reads:
                self.fail_reads -= 1
                raise RuntimeError("injected virtual read failure")
            if reading is None:
                reading = self.frozen_reading or await super().read()
            event["frozen"] = reading is self.frozen_reading
            if self.invalid_reads:
                kind = self.invalid_reads.pop(0)
                if kind == "nonfinite":
                    reading = dataclasses.replace(reading, bt=math.nan)
                elif kind == "future":
                    reading = dataclasses.replace(reading, timestamp=time.monotonic() + 60.0)
                elif kind == "backward":
                    reading = dataclasses.replace(reading, timestamp=reading.timestamp - 60.0)
                else:
                    raise RuntimeError(f"unknown invalid read injection: {kind}")
                event["injected"] = kind
            event.update(
                phase="completed",
                bt=reading.bt if math.isfinite(reading.bt) else None,
                source_timestamp=reading.timestamp,
                completed_at=time.monotonic(),
            )
            self.last_reading = reading
            return reading
        except asyncio.CancelledError:
            event["phase"] = "cancelled"
            raise
        except Exception as exc:
            event.update(phase="failed", error=type(exc).__name__, completed_at=time.monotonic())
            raise

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
        **kwargs: Any,
    ) -> None:
        requested = {
            role: float(value)
            for role, value in (("heater", heater), ("fan", fan), ("drum", drum))
            if value is not None
        }
        event: JSON = {
            "phase": "started",
            "at": time.monotonic(),
            "requested": requested,
            "fenced": bool(kwargs),
        }
        self.writes.append(event)
        try:
            if self.block_next_write and heater is not None:
                self.block_next_write = False
                event["gated"] = True
                self.write_started.set()
                await self.write_gate.wait()
            if heater == 0.0 and self.fail_zero_writes:
                self.fail_zero_writes -= 1
                raise RuntimeError("injected virtual minimum-write failure")
            await super().control(
                heater=heater,
                fan=fan,
                drum=drum,
                **kwargs,
            )
            event.update(phase="applied", completed_at=time.monotonic(), state=dict(self._cmd))
        except asyncio.CancelledError:
            event["phase"] = "cancelled"
            raise
        except Exception as exc:
            event.update(phase="failed", error=type(exc).__name__, completed_at=time.monotonic(), state=dict(self._cmd))
            raise


class CheckFailed(AssertionError):
    pass


class LiveDriver:
    def __init__(self, log: logging.Logger) -> None:
        self.log = log
        self.adapters: list[ControlledVirtualAdapter] = []
        self.app: web.Application | None = None
        self.runner: web.AppRunner | None = None
        self.client: ClientSession | None = None
        self.base_url = ""
        self.port = 0
        self.tasks: set[asyncio.Task[Any]] = set()
        self.cleanup: JSON = {}
        self.requests: list[JSON] = []
        self._original_make_adapter = manager_module.make_adapter

    @property
    def manager(self):
        assert self.app is not None
        return self.app["manager"]

    @property
    def adapter(self) -> ControlledVirtualAdapter:
        if not self.adapters:
            raise CheckFailed("virtual adapter was not created")
        return self.adapters[-1]

    def _make_adapter(self, protocol: str, params: JSON) -> ControlledVirtualAdapter:
        if protocol != "virtual":
            raise ValueError("live verification refuses every adapter except virtual")
        adapter = ControlledVirtualAdapter(**params)
        self.adapters.append(adapter)
        return adapter

    async def __aenter__(self) -> "LiveDriver":
        manager_module.make_adapter = self._make_adapter
        self.app = sidecar_main.create_app()
        self.runner = web.AppRunner(self.app, access_log=None)
        await self.runner.setup()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        self.port = int(listener.getsockname()[1])
        if self.port == 9999:
            listener.close()
            raise RuntimeError("refusing reserved sidecar port 9999")
        await web.SockSite(self.runner, listener).start()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.client = ClientSession(
            headers={sidecar_main.TOKEN_HEADER: os.environ["SIDECAR_TOKEN"]},
            timeout=ClientTimeout(total=12.0),
        )
        return self

    async def __aexit__(self, *_: Any) -> None:
        try:
            for adapter in self.adapters:
                adapter.release_gates()
            for task in self.tasks:
                if not task.done():
                    task.cancel()
            if self.tasks:
                await asyncio.gather(*self.tasks, return_exceptions=True)
            if self.client is not None:
                await self.client.close()
            if self.runner is not None:
                await self.runner.cleanup()
            heat = self.manager._heat
            self.cleanup = {
                "owned_tasks_pending": sum(not task.done() for task in self.tasks),
                "heater_writers_pending": sum(not task.done() for task in heat._writers),
                "heater_loop_pending": heat.task is not None and not heat.task.done(),
                "reconnect_pending": (
                    self.manager._reconnect_task is not None
                    and not self.manager._reconnect_task.done()
                ),
                "adapters_connected": sum(bool(adapter.connected) for adapter in self.adapters),
            }
        finally:
            manager_module.make_adapter = self._original_make_adapter

    def spawn(self, awaitable: Awaitable[Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(awaitable)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def request(self, path: str, payload: Any = None) -> HttpOutcome:
        assert self.client is not None
        method = "GET" if payload is None else "POST"
        started_at = time.monotonic()
        started = time.perf_counter()
        async with self.client.request(method, self.base_url + path, json=payload) as response:
            raw = await response.text()
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = raw
            outcome = HttpOutcome(
                method,
                path,
                response.status,
                body,
                (time.perf_counter() - started) * 1000,
                started_at,
                time.monotonic(),
                payload,
            )
            self.requests.append(outcome.json())
            self.log.info("%s %s -> %s %s", method, path, response.status, body)
            return outcome

    async def fresh_connect(self) -> HttpOutcome:
        status = await self.request("/status")
        if isinstance(status.body, dict) and status.body.get("connected"):
            disconnected = await self.request("/disconnect", {})
            require(disconnected.status == 200, "disconnect before scenario failed", disconnected)
        connected = await self.request(
            "/connect", {"roaster": "virtual", "machine_id": "fsd-live", "sim": "thermal"}
        )
        require(connected.status == 200, "virtual connection failed", connected)
        require(connected.body.get("roaster") == "virtual", "non-virtual adapter connected", connected)
        require(connected.body.get("connected") is True, "virtual adapter is not connected", connected)
        return connected

    async def heater_status(self) -> tuple[HttpOutcome, JSON]:
        status = await self.request("/status")
        require(status.status == 200, "status request failed", status)
        control = status.body.get("heater_control")
        require(isinstance(control, dict), "status lacks heater_control", status)
        for field in ("connection_epoch", "generation", "origin", "pending_writes"):
            require(field in control, f"heater_control lacks {field}", status)
        return status, control

    async def claim_replay(self) -> tuple[HttpOutcome, JSON]:
        _, control = await self.heater_status()
        claim = await self.request(
            "/control/replay/claim",
            {
                "connection_epoch": control["connection_epoch"],
                "generation": control["generation"],
            },
        )
        require(claim.status == 200, "Replay claim failed", claim)
        ticket = claim.body.get("ticket")
        require(isinstance(ticket, dict), "Replay claim lacks ticket", claim)
        require(ticket.get("origin") == "replay", "Replay ticket has wrong origin", claim)
        return claim, ticket


def require(condition: bool, message: str, evidence: Any = None) -> None:
    if not condition:
        if isinstance(evidence, HttpOutcome):
            evidence = evidence.json()
        raise CheckFailed(f"{message}: {evidence!r}")


def sample_identity(payload: JSON | None) -> Any:
    if not isinstance(payload, dict):
        return None
    value = payload.get("sample_id", payload.get("sample"))
    if isinstance(value, dict):
        return {key: value.get(key) for key in ("clock", "sequence")}
    if "sensor_clock" in payload and "timestamp" in payload:
        return {"clock": payload["sensor_clock"], "acquired_at": payload["timestamp"]}
    return value


def applied_writes(adapter: ControlledVirtualAdapter, start: int = 0) -> list[JSON]:
    return [event for event in adapter.writes[start:] if event.get("phase") == "applied"]


async def scenario_manual_fixed(driver: LiveDriver) -> JSON:
    steps: list[JSON] = []
    await driver.fresh_connect()
    adapter = driver.adapter
    manual = await driver.request("/control", {"heater": 23, "origin": "manual"})
    steps.append(manual.json())
    require(manual.status == 200 and manual.body.get("applied", {}).get("heater") == 23, "manual write failed", manual)
    require(adapter._cmd.get("heater") == 23, "manual write did not reach adapter", adapter.writes)
    started = await driver.request("/pid/on", {"sv": 180})
    steps.append(started.json())
    require(started.status == 200 and started.body.get("pid", {}).get("state") == "running", "fixed PID start regressed", started)
    conflict = await driver.request("/control", {"heater": 31, "origin": "manual"})
    steps.append(conflict.json())
    require(conflict.status == 409, "ordinary manual write bypassed fixed PID owner", conflict)
    stopped = await driver.request("/pid/off", {"mode": "zero"})
    steps.append(stopped.json())
    require(stopped.status == 200 and stopped.body.get("pid", {}).get("state") == "off", "fixed PID stop regressed", stopped)
    require(adapter._cmd.get("heater") == 0.0, "fixed PID zero stop did not reach adapter", adapter.writes)
    return {"steps": steps, "writes": adapter.writes}


async def scenario_replay_conflict(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    old_claim, old_ticket = await driver.claim_replay()
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start", started)
    adapter = driver.adapter
    before = len(adapter.writes)
    old_write = await driver.request("/control", {"heater": 53, **old_ticket})
    require(old_write.status == 409, "old Replay heater command displaced fixed PID", old_write)
    require(len(adapter.writes) == before, "rejected Replay command reached adapter", adapter.writes[before:])
    _, control = await driver.heater_status()
    claim = await driver.request(
        "/control/replay/claim",
        {"connection_epoch": control["connection_epoch"], "generation": control["generation"]},
    )
    require(claim.status == 409, "Replay claim displaced fixed PID", claim)
    stopped = await driver.request("/pid/off", {"mode": "zero"})
    require(stopped.status == 200, "cleanup PID stop failed", stopped)
    replay_claim, ticket = await driver.claim_replay()
    replay = await driver.request("/control", {"heater": 29, **ticket})
    require(replay.status == 200, "ticketed Replay write failed", replay)
    retry = await driver.request(
        "/control", {"heater": 29, **ticket, "retry_epoch": ticket["connection_epoch"]}
    )
    require(retry.status == 200, "ticketed Replay retry failed", retry)
    return {
        "old_replay_claim": old_claim.json(),
        "old_replay_write": old_write.json(),
        "start": started.json(),
        "conflicting_claim": claim.json(),
        "stop": stopped.json(),
        "replay_claim": replay_claim.json(),
        "replay": replay.json(),
        "retry": retry.json(),
        "writes": driver.adapter.writes,
    }


async def scenario_takeover_barrier(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    _, ticket = await driver.claim_replay()
    adapter = driver.adapter
    adapter.gate_next_write()
    replay_task = driver.spawn(driver.request("/control", {"heater": 41, **ticket}))
    await asyncio.wait_for(adapter.write_started.wait(), 2.0)
    takeover_task = driver.spawn(
        driver.request("/control", {"heater": 17, "origin": "manual", "takeover": True})
    )
    await asyncio.sleep(0.1)
    require(not takeover_task.done(), "takeover acknowledged before admitted write drained")
    adapter.write_gate.set()
    replay, takeover = await asyncio.gather(replay_task, takeover_task)
    require(replay.status == 409, "superseded queued Replay write was not rejected", replay)
    require(takeover.status == 200, "manual takeover failed after drain", takeover)
    require(adapter._cmd.get("heater") == 17, "manual takeover did not win at adapter", adapter.writes)
    stale = await driver.request("/control", {"heater": 55, **ticket})
    require(stale.status == 409, "revoked Replay ticket wrote after takeover", stale)
    require(adapter._cmd.get("heater") == 17, "stale Replay changed adapter state", adapter.writes)
    delayed_claim = await driver.request(
        "/control/replay/claim",
        {
            "connection_epoch": ticket["connection_epoch"],
            "generation": ticket["generation"],
        },
    )
    require(delayed_claim.status == 409, "delayed Replay claim reacquired after takeover", delayed_claim)
    replay_writes = list(adapter.writes)
    await driver.fresh_connect()
    adapter = driver.adapter
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start for writer barrier", started)
    adapter.gate_next_write()
    await asyncio.wait_for(adapter.write_started.wait(), config.PID_TICK_S + 2.0)
    pid_write = adapter.writes[-1]
    before_takeover = dict(adapter._cmd)
    takeover_task = driver.spawn(
        driver.request("/control", {"heater": 17, "origin": "manual", "takeover": True})
    )
    delay_started = time.monotonic()
    await asyncio.sleep(0.1)
    during, control = await driver.heater_status()
    require(not takeover_task.done(), "manual takeover acknowledged before PID writer drained")
    require(control["pending_writes"] == 1, "PID writer was not pending during takeover", during)
    require(adapter._cmd == before_takeover, "gated PID write took effect before release", adapter.writes)
    released_at = time.monotonic()
    adapter.write_gate.set()
    pid_takeover = await takeover_task
    require(pid_takeover.status == 200, "manual takeover failed after PID drain", pid_takeover)
    require(pid_write.get("phase") == "failed" and pid_write.get("error") == "ControlUnavailable", "revoked PID write was not fenced at adapter", pid_write)
    require(pid_write.get("state") == before_takeover, "revoked PID write changed actual command state", pid_write)
    require(pid_write["completed_at"] <= adapter.writes[-1]["at"] <= pid_takeover.completed_at, "manual write bypassed PID writer barrier", adapter.writes)
    require(pid_takeover.elapsed_ms >= 100, "takeover did not include controlled delay", pid_takeover)
    after_ack = len(adapter.writes)
    runtime = await driver.request("/temperatures")
    require(runtime.body.get("pid", {}).get("state") == "off", "takeover retained automatic runtime", runtime)
    await asyncio.sleep(2 * config.PID_TICK_S + 0.2)
    later = await driver.request("/temperatures")
    require(len(adapter.writes) == after_ack and adapter._cmd.get("heater") == 17, "automatic write occurred after takeover acknowledgement", adapter.writes[after_ack:])
    require(later.body.get("pid", {}).get("state") == "off", "PID restarted after takeover", later)
    return {
        "replay": replay.json(),
        "takeover": takeover.json(),
        "stale": stale.json(),
        "delayed_claim": delayed_claim.json(),
        "replay_writes": replay_writes,
        "pid_start": started.json(),
        "pid_takeover": pid_takeover.json(),
        "pending_status": during.json(),
        "runtime_off": [runtime.json(), later.json()],
        "controlled_delay_ms": 100,
        "gate_hold_ms": (released_at - delay_started) * 1000,
        "gate_released_at": released_at,
        "writes": adapter.writes,
    }


async def scenario_stop_during_read(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start", started)
    adapter = driver.adapter
    adapter.gate_next_read()
    await asyncio.wait_for(adapter.read_started.wait(), config.PID_TICK_S + 2.0)
    write_start = len(adapter.writes)
    stopped = await asyncio.wait_for(driver.request("/pid/off", {"mode": "zero"}), 2.0)
    require(stopped.status == 200, "stop blocked behind an in-flight read", stopped)
    adapter.read_gate.set()
    await asyncio.sleep(config.PID_TICK_S + 0.2)
    later = applied_writes(adapter, write_start)
    require(later and later[0]["requested"].get("heater") == 0.0, "stop did not apply terminal zero", later)
    require(not any(event["requested"].get("heater", 0) > 0 for event in later[1:]), "post-read callback wrote after stop", later)
    return {"start": started.json(), "stop": stopped.json(), "reads": adapter.reads, "writes": adapter.writes}


async def scenario_cache_age(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    adapter = driver.adapter
    seeded = await driver.request("/temperatures")
    require(seeded.status == 200, "seed temperature read failed", seeded)
    seed_id = sample_identity(seeded.body)
    require(seed_id is not None, "temperature response lacks source sample identity", seeded)
    seed_reads = len(adapter.reads)
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start from cached sample", started)
    cached_id = sample_identity(driver.manager._last_good)
    require(cached_id == seed_id, "cached PID acquisition minted a fresh identity", driver.manager._last_good)
    require(len(adapter.reads) == seed_reads, "fresh cache caused another adapter acquisition", adapter.reads[seed_reads:])
    await asyncio.sleep(config.READING_MAX_AGE_S + config.PID_TICK_S + 0.2)
    fresh_id = sample_identity(driver.manager._last_good)
    require(len(adapter.reads) > seed_reads, "expired cache did not acquire a new sample", adapter.reads)
    require(fresh_id != seed_id, "new acquisition retained the old sample identity", driver.manager._last_good)
    stopped = await driver.request("/pid/off", {"mode": "zero"})
    require(stopped.status == 200, "cleanup PID stop failed", stopped)
    refresh_evidence = {"seed": seeded.json(), "seed_identity": seed_id, "fresh_identity": fresh_id, "reads": list(adapter.reads), "writes": list(adapter.writes)}
    await driver.fresh_connect()
    adapter = driver.adapter
    warmup = await driver.request("/control", {"heater": 50, "origin": "manual"})
    require(warmup.status == 200, "source-age thermal warmup failed", warmup)
    await asyncio.sleep(1.0)
    write_start = len(adapter.writes)
    started = await driver.request("/pid/on", {"sv": 50})
    require(started.status == 200, "fixed PID did not start for source-age policy", started)
    await asyncio.sleep(0.1)
    frozen_seed = await driver.request("/temperatures")
    require(frozen_seed.status == 200 and adapter.last_reading is not None, "frozen source acquisition failed", frozen_seed)
    adapter.frozen_reading = adapter.last_reading
    frozen_id = sample_identity(frozen_seed.body)
    acquired_at = adapter.frozen_reading.timestamp
    frozen_read_start = len(adapter.reads)
    polls: list[JSON] = []
    first_calculation: JSON | None = None
    holding: JSON | None = None
    fault: HttpOutcome | None = None
    bound = config.PID_PV_MAX_AGE_S + config.PID_HOLD_TIMEOUT_S + 2 * config.PID_TICK_S + 0.5
    while time.monotonic() - acquired_at <= bound:
        outcome = await driver.request("/temperatures")
        age = outcome.completed_at - acquired_at
        polls.append({"source_age_s": age, **outcome.json()})
        require(sample_identity(outcome.body) == frozen_id, "frozen acquisition gained a new identity", outcome)
        require(outcome.body.get("timestamp") == acquired_at, "frozen acquisition was retimestamped", outcome)
        pid = outcome.body.get("pid", {})
        if pid.get("state") in {"running", "holding"} and pid.get("duty") is not None:
            if first_calculation is None:
                first_calculation = dict(pid)
            require(pid.get("i") == first_calculation["i"], "repeated frozen source was reintegrated", outcome)
        if pid.get("state") == "holding" and holding is None:
            holding = polls[-1]
        if pid.get("state") == "fault":
            fault = outcome
            break
        await asyncio.sleep(0.2)
    require(first_calculation is not None, "real PID loop never consumed the seed", polls)
    require(0 < first_calculation["duty"] < 100, "frozen-source integral check was masked by saturation", first_calculation)
    require(holding is not None and holding["source_age_s"] >= config.PID_PV_MAX_AGE_S, "frozen source never reached configured holding age", polls)
    require(fault is not None and bool(fault.body.get("pid", {}).get("error")), "frozen source never exposed a fault and reason within configured bound", polls)
    require(fault.completed_at - holding["completed_at"] >= config.PID_HOLD_TIMEOUT_S - 0.25, "fault bypassed configured hold timeout", polls)
    effects = applied_writes(adapter, write_start)
    require(len(effects) == 2 and effects[-1]["requested"].get("heater") == 0.0, "frozen source wrote repeatedly or omitted terminal minimum", effects)
    require(adapter._cmd.get("heater") == 0.0, "source-age fault minimum did not reach adapter", adapter.writes)
    require(all(event.get("frozen") is True and event.get("source_timestamp") == acquired_at for event in adapter.reads[frozen_read_start:]), "frozen acquisition identity was not preserved at source", adapter.reads)
    return {"refresh": refresh_evidence, "warmup": warmup.json(), "frozen_seed": frozen_seed.json(), "start": started.json(), "configured_bound_s": bound, "polls": polls, "fault": fault.json(), "reads": adapter.reads, "writes": adapter.writes}


async def scenario_invalid_sample(driver: LiveDriver) -> JSON:
    invalid_cases: list[JSON] = []
    for kind in ("nonfinite", "future", "backward"):
        await driver.fresh_connect()
        adapter = driver.adapter
        good = await driver.request("/temperatures")
        good_id = sample_identity(good.body)
        require(good.status == 200 and good_id is not None, "valid sample seed failed", good)
        adapter.invalid_reads.append(kind)
        invalid = await driver.request("/temperatures")
        require(invalid.status == 200 and invalid.body.get("stale") is True, f"{kind} sample was not rejected as stale", invalid)
        require(sample_identity(invalid.body) == good_id, f"{kind} sample minted a source identity", invalid)
        require(invalid.body.get("timestamp") == good.body.get("timestamp"), "stale response changed source acquisition time", invalid)
        require(invalid.body.get("bt_raw") is None, "stale response exposed invalid raw BT", invalid)
        status = await driver.request("/status")
        require(status.body.get("connected") and not status.body.get("reconnecting"), "invalid case was confounded by reconnect", status)
        invalid_cases.append({"injection": kind, "good": good.json(), "invalid": invalid.json(), "status": status.json(), "reads": list(adapter.reads)})
    await driver.fresh_connect()
    adapter = driver.adapter
    good = await driver.request("/temperatures")
    adapter.gate_next_read(after_acquisition=True)
    old_poll = driver.spawn(driver.request("/temperatures"))
    await asyncio.wait_for(adapter.read_started.wait(), 2.0)
    buffered = adapter.reads[-1]
    replacement = await driver.request("/connect", {"roaster": "virtual", "machine_id": "fsd-replacement", "sim": "thermal"})
    require(replacement.status == 200 and driver.adapter is not adapter, "replacement did not complete while old read buffered", replacement)
    require(not old_poll.done() and buffered.get("buffered") is True, "old measurement was not acquired before replacement", buffered)
    adapter.read_gate.set()
    late = await old_poll
    require(late.status == 200 and late.body.get("bt") is None and late.body.get("bt_raw") is None, "previous connection sample escaped into public temperature", late)
    require(sample_identity(late.body) is None and driver.manager._last_good is None, "previous connection sample contaminated replacement cache", late)
    fresh = await driver.request("/temperatures")
    require(fresh.body.get("bt_raw") is not None and not fresh.body.get("stale"), "replacement did not produce fresh PV", fresh)
    require(fresh.body.get("sensor_clock") != good.body.get("sensor_clock") and fresh.body["timestamp"] > buffered["acquired_at"], "replacement reused old acquisition identity", fresh)
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "PID could not start with replacement PV", started)
    await asyncio.sleep(config.READING_MAX_AGE_S + config.PID_TICK_S + 0.2)
    runtime = await driver.request("/temperatures")
    require(runtime.body.get("pid", {}).get("state") == "running" and runtime.body.get("sensor_clock") == fresh.body["sensor_clock"], "PID did not retain replacement source clock", runtime)
    require(bool(applied_writes(driver.adapter)), "replacement PID loop did not execute", driver.adapter.writes)
    stopped = await driver.request("/pid/off", {"mode": "zero"})
    require(stopped.status == 200, "replacement PID cleanup failed", stopped)
    return {"invalid_cases": invalid_cases, "old_good": good.json(), "buffered_read": buffered, "replacement": replacement.json(), "late_old_response": late.json(), "fresh": fresh.json(), "pid_start": started.json(), "runtime": runtime.json(), "stop": stopped.json(), "old_reads": adapter.reads, "new_reads": driver.adapter.reads, "new_writes": driver.adapter.writes}


async def scenario_epoch_fence(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    _, ticket = await driver.claim_replay()
    applied = await driver.request("/control", {"heater": 31, **ticket})
    require(applied.status == 200, "Replay setup write failed", applied)
    adapter = driver.adapter
    adapter_count = len(driver.adapters)
    adapter.gate_next_write()
    queued_task = driver.spawn(driver.request("/control", {"heater": 52, **ticket}))
    await asyncio.wait_for(adapter.write_started.wait(), 2.0)
    queued_event = adapter.writes[-1]
    replacement_task = driver.spawn(driver.request("/connect", {"roaster": "virtual", "machine_id": "fsd-new-epoch", "sim": "thermal"}))
    await asyncio.sleep(0.1)
    pending = await driver.request("/status")
    require(not replacement_task.done(), "replacement acknowledged while old writer was queued")
    require(pending.body.get("connection_epoch") == ticket["connection_epoch"], "replacement advanced epoch before writer barrier", pending)
    require(len(driver.adapters) == adapter_count and driver.adapter is adapter, "replacement adapter created before old writer drained", pending)
    require(pending.body.get("heater_control", {}).get("pending_writes") == 1, "old command was not pending at connection boundary", pending)
    released_at = time.monotonic()
    adapter.write_gate.set()
    queued, replacement = await asyncio.gather(queued_task, replacement_task)
    require(queued.status == 409, "queued previous-epoch command was not rejected", queued)
    require(queued_event.get("phase") == "failed" and queued_event.get("error") == "ControlUnavailable" and adapter._cmd.get("heater") == 31, "queued old command changed actual state", adapter.writes)
    require(replacement.status == 200 and replacement.body["connection_epoch"] > ticket["connection_epoch"], "replacement did not advance after barrier", replacement)
    require(queued_event["completed_at"] <= replacement.completed_at, "replacement acknowledged before old command completed", replacement)
    new_adapter = driver.adapter
    stale = await driver.request("/control", {"heater": 52, **ticket})
    require(stale.status == 409, "old connection epoch was accepted", stale)
    require(new_adapter is not adapter and not new_adapter.writes, "old epoch reached replacement adapter", new_adapter.writes)
    return {"ticket": ticket, "applied": applied.json(), "queued": queued.json(), "pending": pending.json(), "gate_released_at": released_at, "replacement": replacement.json(), "stale": stale.json(), "old_writes": adapter.writes, "new_writes": new_adapter.writes}


async def scenario_failed_minimum_stop(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    adapter = driver.adapter
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start", started)
    adapter.fail_zero_writes = 20
    failed = await driver.request("/pid/off", {"mode": "zero"})
    require(failed.status in {502, 504}, "failed minimum stop was acknowledged", failed)
    require(adapter._cmd.get("heater") != 0.0, "failed minimum stop reported an adapter effect", adapter.writes)
    _, faulted = await driver.heater_status()
    require(faulted.get("origin") == "safety", "failed minimum stop did not retain safety ownership", faulted)
    runtime = await driver.request("/temperatures")
    require(runtime.body.get("pid", {}).get("state") == "fault", "failed minimum stop did not expose runtime fault", runtime)
    require(bool(runtime.body.get("pid", {}).get("error")), "failed minimum stop lost its runtime error", runtime)
    adapter.fail_zero_writes = 0
    recovered = await driver.request("/pid/off", {"mode": "zero"})
    require(recovered.status == 200, "minimum stop could not be retried", recovered)
    require(adapter._cmd.get("heater") == 0.0, "retried minimum stop did not reach adapter", adapter.writes)
    return {"start": started.json(), "failed": failed.json(), "faulted": faulted, "runtime_fault": runtime.json(), "recovered": recovered.json(), "writes": adapter.writes}


async def scenario_fan_drum_independence(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    _, ticket = await driver.claim_replay()
    before_status, before = await driver.heater_status()
    controlled = await driver.request("/control", {"fan": 37, "drum": 48, "origin": "manual"})
    require(controlled.status == 200, "fan/drum write conflicted with Replay heater owner", controlled)
    _, after = await driver.heater_status()
    require(after["origin"] == "replay" and after["generation"] == before["generation"], "fan/drum changed heater ownership", {"before": before, "after": after})
    require(driver.adapter._cmd.get("fan") == 37 and driver.adapter._cmd.get("drum") == 48, "fan/drum did not reach adapter", driver.adapter.writes)
    released = await driver.request(
        "/control/replay/release",
        {"connection_epoch": ticket["connection_epoch"], "generation": ticket["generation"]},
    )
    require(released.status == 200, "Replay release failed", released)
    pid_started = await driver.request("/pid/on", {"sv": 180})
    require(pid_started.status == 200, "fixed PID did not start for independent controls", pid_started)
    _, pid_before = await driver.heater_status()
    pid_controlled = await driver.request("/control", {"fan": 37, "drum": 48, "origin": "manual"})
    require(pid_controlled.status == 200, "fan/drum write conflicted with PID heater owner", pid_controlled)
    _, pid_after = await driver.heater_status()
    require(pid_after["origin"] == "pid" and pid_after["generation"] == pid_before["generation"], "fan/drum changed PID heater ownership", {"before": pid_before, "after": pid_after})
    require(driver.adapter._cmd.get("fan") == 37 and driver.adapter._cmd.get("drum") == 48, "PID-owned fan/drum control did not reach adapter", driver.adapter.writes)
    pid_stopped = await driver.request("/pid/off", {"mode": "zero"})
    require(pid_stopped.status == 200, "cleanup PID stop failed", pid_stopped)
    return {"before": before_status.json(), "control": controlled.json(), "after": after, "release": released.json(), "pid_start": pid_started.json(), "pid_control": pid_controlled.json(), "pid_after": pid_after, "pid_stop": pid_stopped.json(), "writes": driver.adapter.writes}


async def scenario_reconnect_off(driver: LiveDriver) -> JSON:
    connected = await driver.fresh_connect()
    old_epoch = connected.body["connection_epoch"]
    adapter = driver.adapter
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start", started)
    stopped = await driver.request("/pid/off", {"mode": "hold"})
    require(stopped.status == 200, "fixed PID hold stop failed", stopped)
    manual = await driver.request(
        "/control", {"heater": 37, "origin": "manual", "takeover": True}
    )
    require(manual.status == 200, "manual setup after fixed stop failed", manual)
    write_start = len(adapter.writes)
    adapter.fail_reads = config.STALE_TOLERANCE_READS + 1
    polls: list[JSON] = []
    for _ in range(config.STALE_TOLERANCE_READS + 1):
        polls.append((await driver.request("/temperatures")).json())
    deadline = time.monotonic() + config.RECONNECT_BACKOFFS[0] + 3.0
    final: HttpOutcome | None = None
    while time.monotonic() < deadline:
        final = await driver.request("/status")
        if final.body.get("connected") and final.body.get("connection_epoch", old_epoch) > old_epoch:
            break
        await asyncio.sleep(0.1)
    require(final is not None and final.body.get("connected") and final.body.get("connection_epoch", old_epoch) > old_epoch, "virtual reconnect did not finish", final)
    later = applied_writes(adapter, write_start)
    require(not any(event["requested"].get("heater") == 0.0 for event in later), "reconnect after fixed-off forced heater zero", later)
    require(adapter._cmd.get("heater") == 37, "reconnect changed off-session manual heater", adapter.writes)
    off_evidence = {"start": started.json(), "stop": stopped.json(), "manual": manual.json(), "polls": polls, "final": final.json(), "writes_after_failure": adapter.writes[write_start:]}
    connected = await driver.fresh_connect()
    old_epoch = connected.body["connection_epoch"]
    adapter = driver.adapter
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "active reconnect PID did not start", started)
    await asyncio.sleep(config.READING_MAX_AGE_S + config.PID_TICK_S + 0.2)
    require(any(event["requested"].get("heater", 0) > 0 for event in applied_writes(adapter)), "real PID loop did not apply heating before read loss", adapter.writes)
    write_start = len(adapter.writes)
    adapter.fail_reads = config.STALE_TOLERANCE_READS + 1
    polls = []
    fault = None
    final = None
    deadline = time.monotonic() + config.RECONNECT_BACKOFFS[0] + 3 * config.PID_TICK_S + 2.0
    while time.monotonic() < deadline:
        runtime = await driver.request("/temperatures")
        polls.append(runtime.json())
        if runtime.body.get("pid", {}).get("state") == "fault":
            fault = runtime
        status = await driver.request("/status")
        polls.append(status.json())
        if status.body.get("connected") and status.body.get("connection_epoch", old_epoch) > old_epoch and not status.body.get("reconnecting"):
            final = status
            break
        await asyncio.sleep(0.1)
    require(fault is not None and bool(fault.body.get("pid", {}).get("error")), "read loss did not expose active PID fault before reconnect", polls)
    require(final is not None, "active PID connection did not recover automatically", polls)
    later = applied_writes(adapter, write_start)
    require(later and all(event["requested"].get("heater") == 0.0 for event in later), "active reconnect omitted minimum or resumed heating", later)
    require(adapter._cmd.get("heater") == 0.0, "reconnect minimum did not reach actual adapter", adapter.writes)
    after_reconnect = len(adapter.writes)
    off = await driver.request("/temperatures")
    require(off.body.get("pid", {}).get("state") == "off" and final.body.get("heater_control", {}).get("origin") == "manual", "reconnect retained automatic ownership", {"runtime": off.json(), "status": final.json()})
    await asyncio.sleep(2 * config.PID_TICK_S + 0.2)
    still_off = await driver.request("/temperatures")
    require(still_off.body.get("pid", {}).get("state") == "off" and len(adapter.writes) == after_reconnect, "automatic heating resumed without explicit start", adapter.writes[after_reconnect:])
    restarted = await driver.request("/pid/on", {"sv": 180})
    require(restarted.status == 200, "explicit PID restart failed after reconnect", restarted)
    await asyncio.sleep(config.READING_MAX_AGE_S + config.PID_TICK_S + 0.2)
    require(any(event["requested"].get("heater", 0) > 0 for event in applied_writes(adapter, after_reconnect)), "explicit restart did not execute real PID loop", adapter.writes[after_reconnect:])
    stopped = await driver.request("/pid/off", {"mode": "zero"})
    require(stopped.status == 200, "restarted PID cleanup failed", stopped)
    return {"manual_37_preservation": off_evidence, "active_start": started.json(), "read_loss_polls": polls, "public_fault": fault.json(), "reconnected": final.json(), "off": [off.json(), still_off.json()], "explicit_restart": restarted.json(), "stop": stopped.json(), "reads": adapter.reads, "writes": adapter.writes}


SCENARIOS = {
    "manual_fixed_regression": scenario_manual_fixed,
    "replay_conflict": scenario_replay_conflict,
    "takeover_barrier": scenario_takeover_barrier,
    "stop_during_read": scenario_stop_during_read,
    "cache_age": scenario_cache_age,
    "invalid_sample": scenario_invalid_sample,
    "epoch_fence": scenario_epoch_fence,
    "failed_minimum_stop": scenario_failed_minimum_stop,
    "fan_drum_independence": scenario_fan_drum_independence,
    "reconnect_off": scenario_reconnect_off,
}


async def run_scenarios(driver: LiveDriver, selected: list[str]) -> list[JSON]:
    results: list[JSON] = []
    for name in selected:
        started = time.perf_counter()
        request_start = len(driver.requests)
        adapter_start = len(driver.adapters)
        try:
            evidence = await SCENARIOS[name](driver)
            results.append(
                {
                    "name": name,
                    "status": "pass",
                    "elapsed_ms": (time.perf_counter() - started) * 1000,
                    "evidence": copy.deepcopy(evidence),
                }
            )
        except Exception as exc:
            driver.log.exception("scenario failed: %s", name)
            results.append(
                {
                    "name": name,
                    "status": "fail",
                    "elapsed_ms": (time.perf_counter() - started) * 1000,
                    "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                    "adapter_reads": driver.adapter.reads if driver.adapters else [],
                    "adapter_writes": driver.adapter.writes if driver.adapters else [],
                }
            )
        finally:
            results[-1]["http_transcript"] = driver.requests[request_start:]
            results[-1]["adapter_transcripts"] = copy.deepcopy([
                {"reads": list(adapter.reads), "writes": list(adapter.writes)}
                for adapter in driver.adapters[adapter_start:]
            ])
            results[-1] = copy.deepcopy(results[-1])
            for adapter in driver.adapters:
                adapter.release_gates()
    return results


async def run_performance(
    driver: LiveDriver, trials: int, commands: int, baseline_path: Path | None
) -> JSON:
    await driver.fresh_connect()
    adapter = driver.adapter
    result: JSON = {
        "trial_count": trials,
        "commands_per_trial": commands,
        "trials": [],
        "http_errors": 0,
        "adapter_write_errors": 0,
        "max_pending_writes": 0,
    }
    for trial in range(1, trials + 1):
        before = len(adapter.writes)
        elapsed: list[float] = []
        successful = 0
        for number in range(commands):
            outcome = await driver.request(
                "/control", {"heater": float(number % 80), "origin": "manual"}
            )
            if outcome.status == 200 and outcome.body.get("applied", {}).get("heater") == float(number % 80):
                successful += 1
                elapsed.append(outcome.elapsed_ms)
            else:
                result["http_errors"] += 1
            if number % 10 == 0 or number == commands - 1:
                _, status = await driver.heater_status()
                result["max_pending_writes"] = max(
                    result["max_pending_writes"], int(status["pending_writes"])
                )
        events = adapter.writes[before:]
        write_errors = sum(event.get("phase") != "applied" for event in events)
        result["adapter_write_errors"] += write_errors
        ordered = sorted(elapsed)
        result["trials"].append(
            {
                "number": trial,
                "successful_responses": successful,
                "actual_writes": sum(event.get("phase") == "applied" for event in events),
                "adapter_write_errors": write_errors,
                "pending_writes_after": (await driver.heater_status())[1]["pending_writes"],
                "p50_ms": statistics.median(elapsed) if elapsed else None,
                "p95_ms": ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)] if ordered else None,
                "max_ms": max(elapsed) if elapsed else None,
            }
        )
    result["passed"] = (
        result["http_errors"] == 0
        and result["adapter_write_errors"] == 0
        and all(
            trial["successful_responses"] == commands
            and trial["actual_writes"] == commands
            and trial["pending_writes_after"] == 0
            for trial in result["trials"]
        )
    )
    if baseline_path is not None and baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        result["baseline"] = {
            "path": str(baseline_path),
            "sha256": sha256_file(baseline_path),
            "trials": baseline.get("trials", []),
        }
        result["comparison"] = {
            "verdict": "inconclusive",
            "reason": "The stored baseline and this head run were not interleaved, and no limiter profile was collected.",
        }
    return result


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_hashes() -> JSON:
    paths = (
        Path(__file__),
        SIDECAR / "main.py",
        SIDECAR / "manager.py",
        SIDECAR / "heater_control_session.py",
        SIDECAR / "pid_runner.py",
        SIDECAR / "control_guard.py",
        SIDECAR / "adapters" / "virtual.py",
    )
    return {
        str(path.relative_to(REPO)): sha256_file(path)
        for path in paths
        if path.exists()
    }


def git_output(*args: str) -> str | None:
    try:
        return subprocess.run(
            ["git", *args], cwd=REPO, check=True, text=True, capture_output=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("scenarios", "perf", "all"), default="scenarios")
    parser.add_argument("--scenario", action="append", choices=tuple(SCENARIOS))
    parser.add_argument("--perf-trials", type=int, default=5)
    parser.add_argument("--commands-per-trial", type=int, default=100)
    parser.add_argument("--base-ref", default="main")
    parser.add_argument("--output", type=Path, default=DEFAULT_EVIDENCE / "fsd01-live.json")
    parser.add_argument("--log", type=Path, default=DEFAULT_EVIDENCE / "fsd01-live.log")
    parser.add_argument(
        "--baseline-json",
        type=Path,
        default=None,
    )
    args = parser.parse_args()
    if args.perf_trials < 1 or args.commands_per_trial < 1:
        parser.error("performance trial counts must be positive")
    return args


async def async_main(args: argparse.Namespace, logger: logging.Logger) -> JSON:
    report: JSON = {
        "contract": "FSD-01",
        "transport": "real HTTP on an owned ephemeral loopback socket",
        "adapter": "virtual thermal simulator with private observation gates",
        "configured_timers_s": {
            "pid_tick": config.PID_TICK_S,
            "pid_pv_max_age": config.PID_PV_MAX_AGE_S,
            "pid_hold_timeout": config.PID_HOLD_TIMEOUT_S,
            "reading_max_age": config.READING_MAX_AGE_S,
            "reconnect_backoffs": config.RECONNECT_BACKOFFS,
        },
        "metadata": {
            "head_sha": git_output("rev-parse", "HEAD"),
            "base_sha": git_output("rev-parse", args.base_ref),
            "script_sha256": sha256_file(Path(__file__)),
            "source_sha256": source_hashes(),
            "git_status": git_output("status", "--short"),
            "python": sys.version,
            "logical_cpus": os.cpu_count(),
            "load_average": os.getloadavg() if hasattr(os, "getloadavg") else None,
            "command": [sys.executable, *sys.argv],
            "started_at_unix": time.time(),
        },
        "scenarios": [],
        "performance": None,
    }
    driver: LiveDriver | None = None
    try:
        async with LiveDriver(logger) as driver:
            report["server"] = {"host": "127.0.0.1", "port": driver.port}
            if args.mode in {"scenarios", "all"}:
                selected = args.scenario or list(SCENARIOS)
                report["scenarios"] = await run_scenarios(driver, selected)
            if args.mode in {"perf", "all"}:
                report["performance"] = await run_performance(
                    driver, args.perf_trials, args.commands_per_trial, args.baseline_json
                )
    except Exception as exc:
        logger.exception("live driver failed")
        report["driver_error"] = f"{type(exc).__name__}: {exc}"
        report["driver_traceback"] = traceback.format_exc()
    finally:
        report["cleanup"] = driver.cleanup if driver is not None else {}
        report["metadata"]["finished_at_unix"] = time.time()
    scenario_ok = all(item.get("status") == "pass" for item in report["scenarios"])
    perf_ok = report["performance"] is None or report["performance"].get("passed") is True
    cleanup_ok = report["cleanup"] == {
        "owned_tasks_pending": 0,
        "heater_writers_pending": 0,
        "heater_loop_pending": False,
        "reconnect_pending": False,
        "adapters_connected": 0,
    }
    report["passed"] = (
        "driver_error" not in report and scenario_ok and perf_ok and cleanup_ok
    )
    return report


def main() -> int:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.log.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(args.log, mode="w", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger = logging.getLogger("verify-fsd")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False
    report = asyncio.run(async_main(args, logger))
    handler.flush()
    report["metadata"]["log_sha256"] = sha256_file(args.log)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": report["passed"],
        "output": str(args.output),
        "log": str(args.log),
        "scenarios": [
            {"name": item["name"], "status": item["status"]}
            for item in report["scenarios"]
        ],
        "performance_passed": (
            report["performance"].get("passed")
            if report["performance"] is not None
            else None
        ),
    }, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

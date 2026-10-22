#!/usr/bin/env python3
"""Run isolated FSD live scenarios against a private virtual sidecar."""

from __future__ import annotations

import argparse
import asyncio
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
        self.read_gate = asyncio.Event()
        self.write_gate = asyncio.Event()
        self.read_started = asyncio.Event()
        self.write_started = asyncio.Event()
        self.read_gate.set()
        self.write_gate.set()

    def gate_next_read(self) -> None:
        self.block_next_read = True
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
            if self.block_next_read:
                self.block_next_read = False
                event["gated"] = True
                self.read_started.set()
                await self.read_gate.wait()
            if self.fail_reads:
                self.fail_reads -= 1
                raise RuntimeError("injected virtual read failure")
            reading = await super().read()
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
            )
            return reading
        except asyncio.CancelledError:
            event["phase"] = "cancelled"
            raise
        except Exception as exc:
            event.update(phase="failed", error=type(exc).__name__)
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
            event.update(phase="failed", error=type(exc).__name__)
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
            )
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
    started = await driver.request("/pid/on", {"sv": 180})
    require(started.status == 200, "fixed PID did not start", started)
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
    return {
        "replay": replay.json(),
        "takeover": takeover.json(),
        "stale": stale.json(),
        "delayed_claim": delayed_claim.json(),
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
    return {"seed": seeded.json(), "seed_identity": seed_id, "fresh_identity": fresh_id, "reads": adapter.reads, "writes": adapter.writes}


async def scenario_invalid_sample(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    adapter = driver.adapter
    good = await driver.request("/temperatures")
    good_id = sample_identity(good.body)
    require(good.status == 200 and good_id is not None, "valid sample seed failed", good)
    adapter.invalid_reads.append("nonfinite")
    invalid = await driver.request("/temperatures")
    require(invalid.status == 200 and invalid.body.get("stale") is True, "non-finite sample was not rejected as stale", invalid)
    require(sample_identity(invalid.body) == good_id, "invalid sample minted a source identity", invalid)
    require(invalid.body.get("timestamp") == good.body.get("timestamp"), "stale response changed source acquisition time", invalid)
    require(invalid.body.get("bt_raw") is None, "stale response exposed invalid raw BT", invalid)
    return {"good": good.json(), "invalid": invalid.json(), "reads": adapter.reads}


async def scenario_epoch_fence(driver: LiveDriver) -> JSON:
    await driver.fresh_connect()
    _, ticket = await driver.claim_replay()
    applied = await driver.request("/control", {"heater": 31, **ticket})
    require(applied.status == 200, "Replay setup write failed", applied)
    disconnected = await driver.request("/disconnect", {})
    require(disconnected.status == 200, "disconnect failed", disconnected)
    await driver.fresh_connect()
    new_adapter = driver.adapter
    stale = await driver.request("/control", {"heater": 52, **ticket})
    require(stale.status == 409, "old connection epoch was accepted", stale)
    require(new_adapter._cmd.get("heater") != 52, "old epoch reached replacement adapter", new_adapter.writes)
    return {"ticket": ticket, "applied": applied.json(), "disconnect": disconnected.json(), "stale": stale.json(), "new_writes": new_adapter.writes}


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
    require(final is not None and final.body.get("connected"), "virtual reconnect did not finish", final)
    later = applied_writes(adapter, write_start)
    require(not any(event["requested"].get("heater") == 0.0 for event in later), "reconnect after fixed-off forced heater zero", later)
    require(adapter._cmd.get("heater") == 37, "reconnect changed off-session manual heater", adapter.writes)
    return {"start": started.json(), "stop": stopped.json(), "manual": manual.json(), "polls": polls, "final": final.json(), "writes_after_failure": adapter.writes[write_start:]}


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
        try:
            evidence = await SCENARIOS[name](driver)
            results.append(
                {
                    "name": name,
                    "status": "pass",
                    "elapsed_ms": (time.perf_counter() - started) * 1000,
                    "evidence": evidence,
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

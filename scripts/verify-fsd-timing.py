#!/usr/bin/env python3
"""Measure real PID cadence and target lookup without changing production clocks."""

from __future__ import annotations

import argparse
import asyncio
from bisect import bisect_left
import cProfile
import hashlib
import importlib.util
import json
import logging
import math
import os
from pathlib import Path
import sys
import time


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def source_hashes(repo):
    paths = list((repo / "src-tauri/sidecar").glob("*.py"))
    paths.extend((repo / "src-tauri/sidecar/adapters").glob("*.py"))
    paths.extend(path for path in (repo / "scripts").glob("verify-fsd*.py") if path.name != "verify-fsd-timing.py")
    return {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


async def run(args):
    before = source_hashes(args.repo)
    if args.mode == "curve":
        curve_module = load_module("curve_timing", args.repo / "scripts/verify-fsd-curve.py")
        live = curve_module.live
    else:
        live = load_module("timing_live", args.repo / "scripts/verify-fsd.py")
    import pid_runner
    original_tick = pid_runner.PidRunner.tick
    ticks = []
    schedule_origins = []
    from heater_control_session import HeaterControlSession
    for name in ("_loop", "_curve_loop"):
        original_loop = getattr(HeaterControlSession, name, None)
        if original_loop is None:
            continue

        async def measured_loop(self, runner, ticket, original=original_loop):
            schedule_origins.append(time.monotonic())
            return await original(self, runner, ticket)

        setattr(HeaterControlSession, name, measured_loop)

    async def measured_tick(self):
        tick = {"started_at": time.monotonic()}
        ticks.append(tick)
        try:
            await original_tick(self)
            tick["state"] = self.state_name
            tick["output"] = self.state()
        except Exception as error:
            tick["error"] = repr(error)
            raise
        finally:
            tick["completed_at"] = time.monotonic()

    pid_runner.PidRunner.tick = measured_tick
    logger = logging.getLogger("timing")
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    report = {"repo": str(args.repo), "mode": args.mode, "source_before": before,
              "head": live.git_output("rev-parse", "HEAD"), "load_start": os.getloadavg(),
              "logical_cpus": os.cpu_count(), "write_delay_sec": args.write_delay,
              "python": sys.version, "python_executable": sys.executable, "platform": sys.platform,
              "errors": [], "duration_sec": args.seconds}
    report["harness_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    profile = cProfile.Profile() if args.profile else None
    async with live.LiveDriver(logger) as driver:
        report["port"] = driver.port
        if args.mode == "curve":
            reference = await maximum_reference(curve_module)
            lane = curve_module.CurveLane(driver, reference)
            await lane.prepare()
        else:
            await driver.fresh_connect()
            await driver.request("/control", {"heater": 50, "origin": "manual"})
        adapter = driver.adapter
        control = adapter.control

        async def delayed_control(*values, **kwargs):
            await asyncio.sleep(args.write_delay)
            return await control(*values, **kwargs)

        adapter.control = delayed_control
        if args.mode == "curve":
            started, _ = await lane.start()
        else:
            started = await driver.request("/pid/on", {"sv": 150})
        live.require(started.status == 200, "timing start failed", started)
        ticks.clear()
        cpu_start = time.process_time()
        wall_start = time.monotonic()
        if profile:
            profile.enable()
        poll_count = 0
        deadline = wall_start + args.seconds
        while time.monotonic() < deadline:
            if args.mode == "curve":
                renewed = await driver.request("/pid/renew", lane.authority)
                live.require(renewed.status == 200, "timing renew failed", renewed)
            response = await driver.request("/temperatures")
            live.require(response.status == 200 and not response.body.get("stale"), "timing acquisition failed", response)
            poll_count += 1
            await asyncio.sleep(min(0.25, max(0, deadline - time.monotonic())))
        if profile:
            profile.disable()
            profile.dump_stats(str(args.output.with_suffix(".pstats")))
        cpu_s = time.process_time() - cpu_start
        wall_s = time.monotonic() - wall_start
        stop_started = time.perf_counter()
        stopped = await lane.stop() if args.mode == "curve" else await driver.request("/pid/off", {"mode": "zero"})
        stop_ms = (time.perf_counter() - stop_started) * 1000
        live.require(stopped.status == 200, "stop not acknowledged", stopped)
        live.require(adapter._cmd.get("heater") == 0, "acknowledged stop not applied")
        live.require(driver.manager._heat.runner.state_name == "off", "acknowledged stop retained runner")
        live.require(len(ticks) >= math.floor(args.seconds) - 1, "missing required tick deadlines", ticks)
        live.require(all(row.get("state") == "running" for row in ticks), "runner left running state", ticks)
        intervals = [right["started_at"] - left["started_at"] for left, right in zip(ticks, ticks[1:])]
        live.require(all(interval < 2 for interval in intervals), "skipped required tick deadline", ticks)
        live.require(all(row["output"]["duty"] is not None and math.isfinite(row["output"]["duty"])
                         and 0 <= row["output"]["duty"] <= 100 for row in ticks), "invalid PID output", ticks)
        live.require(len(schedule_origins) == 1, "unexpected scheduler restart", schedule_origins)
        lateness = [max(0.0, row["started_at"] - schedule_origins[0] - index - 1) * 1000
                    for index, row in enumerate(ticks)]
        timed_writes = [row for row in adapter.writes if wall_start <= row["at"] < wall_start + wall_s]
        live.require(any(row["phase"] == "applied" for row in timed_writes), "no timed writes executed")
        live.require(all(row["phase"] == "applied" for row in adapter.writes), "write failed", adapter.writes)
        report.update(ticks=list(ticks), tick_count=len(ticks), poll_count=poll_count,
                      timed_writes=timed_writes, timed_write_count=len(timed_writes),
                      tick_duration_p95_ms=percentile([(row["completed_at"] - row["started_at"]) * 1000 for row in ticks], 0.95),
                      max_tick_interval_sec=max(intervals),
                      schedule_origin=schedule_origins[0],
                      actual_writes=sum(row["phase"] == "applied" for row in adapter.writes),
                      tick_error_count=sum("error" in row for row in ticks),
                      write_failure_count=sum(row["phase"] != "applied" for row in adapter.writes),
                      rejected_requests=sum(row["status"] >= 400 for row in driver.requests),
                      stop_ms=stop_ms, cpu_s=cpu_s, wall_s=wall_s,
                      single_core_cpu_percent=cpu_s / wall_s * 100,
                      lateness_p95_ms=percentile(lateness, 0.95), lateness_max_ms=max(lateness))
        if args.mode == "curve":
            from roast_target import parse_machine, parse_target, VIRTUAL_CONFIG
            target = parse_target(reference, machine=parse_machine(curve_module.MACHINE), config=VIRTUAL_CONFIG)
            evaluator = []
            checksum = 0.0
            point_times = [point.elapsed_sec for point in target.points]
            for index in range(600):
                elapsed = 40 + index
                clock_start = time.perf_counter_ns()
                value = target.at(elapsed)
                evaluator.append((time.perf_counter_ns() - clock_start) / 1_000_000)
                live.require(math.isfinite(value) and 50 <= value <= 250, "invalid lookup output")
                right = bisect_left(point_times, elapsed)
                fraction = (elapsed - point_times[right - 1]) / (point_times[right] - point_times[right - 1])
                expected = target.filtered[right - 1] + fraction * (target.filtered[right] - target.filtered[right - 1])
                live.require(abs(value - expected) < 1e-9, "lookup returned incorrect interpolation")
                checksum += value
            live.require(checksum > 0 and len(target.points) == 10000, "maximum reference work absent")
            report.update(lookup_count=len(evaluator), lookup_points=len(target.points), lookup_checksum=checksum,
                          lookup_p99_ms=percentile(evaluator, 0.99), lookup_max_ms=max(evaluator), lookup_ms=evaluator)
            live.require(report["lookup_p99_ms"] < 5, "lookup exceeded 5 ms budget")
            restarted, _ = await lane.start()
            live.require(restarted.status == 200, "lease probe restart failed", restarted)
            lease_deadline = restarted.body["curve"]["lease_deadline"]
            observed = None
            while time.monotonic() <= lease_deadline + 0.25:
                await driver.request("/temperatures")
                status = await lane.status()
                if status["heater_control"]["generation"] > lane.authority["generation"]:
                    observed = time.monotonic()
                    break
                await asyncio.sleep(0.01)
            live.require(observed is not None, "lease revocation exceeded 250 ms budget")
            live.require(status["curve"]["reason"] == "lease_expired", "lease reason missing", status)
            report.update(lease_deadline=lease_deadline, lease_revoked_observed_at=observed,
                          lease_revocation_lateness_ms=(observed - lease_deadline) * 1000)
            while status["curve"].get("terminal_outcome") != "completed" and time.monotonic() < lease_deadline + 0.25:
                await asyncio.sleep(0.005)
                status = await lane.status()
            live.require(status["curve"].get("terminal_outcome") == "completed" and adapter._cmd.get("heater") == 0,
                         "lease minimum write was not completed", status)
            report["lease_completed_lateness_ms"] = (time.monotonic() - lease_deadline) * 1000
        report["requests"] = driver.requests
        report["writes"] = adapter.writes
        report["rejected_requests"] = sum(row["status"] >= 400 for row in driver.requests)
    report["cleanup"] = driver.cleanup
    live.require(not any(driver.cleanup.values()), "timing cleanup incomplete", driver.cleanup)
    report["source_after"] = source_hashes(args.repo)
    report["source_stable"] = before == report["source_after"]
    report["load_end"] = os.getloadavg()
    report["passed"] = report["source_stable"] and report["rejected_requests"] == 0
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ("mode", "passed", "tick_count", "lateness_p95_ms", "stop_ms", "actual_writes")}))
    return 0 if report["passed"] else 1


async def maximum_reference(curve_module):
    from adapters.virtual import VirtualMachineAdapter
    clock = [1000.0]
    adapter = VirtualMachineAdapter(sim="thermal", clock=lambda: clock[0])
    await adapter.connect()
    adapter._model.bt = 180
    reference = await curve_module.recorded_reference()
    points = []
    duty = 0
    try:
        for index in range(10000):
            elapsed = index * 1799 / 9999
            clock[0] = 1000 + elapsed
            reading = await adapter.read()
            points.append({"elapsed_sec": elapsed, "acquired_at": reading.timestamp,
                           "sensor_clock": reference["points"][0]["sensor_clock"],
                           "bt_c": reading.bt, "processing": dict(curve_module.PROCESSING)})
            desired = 60 if elapsed >= 36 else 100 if elapsed >= 22 else 0
            if desired != duty:
                await adapter.control(heater=desired)
                duty = desired
    finally:
        await adapter.disconnect()
    reference["points"] = points
    reference["drop"]["elapsed_sec"] = 1799
    return reference


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--mode", choices=("fixed", "curve"), default="fixed")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--write-delay", type=float, default=0.005)
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    options.repo = options.repo.resolve()
    options.output.parent.mkdir(parents=True, exist_ok=True)
    if options.seconds < 5 or options.write_delay < 0:
        parser.error("at least five seconds and nonnegative delay required")
    raise SystemExit(asyncio.run(run(options)))

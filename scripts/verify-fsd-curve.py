#!/usr/bin/env python3
"""Exercise the curve protocol on an owned, token-protected virtual sidecar."""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import importlib.util
import json
import logging
from pathlib import Path
import sys
import time
import traceback
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fsd_live", ROOT / "scripts/verify-fsd.py")
assert spec is not None and spec.loader is not None
live = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = live
spec.loader.exec_module(live)

from roast_target import VIRTUAL_CONFIG, parse_machine, parse_target

MACHINE = {"machine_id": "fsd-live", "roaster_key": "virtual", "protocol": "virtual"}
PROCESSING = {
    "algorithm_version": "ema-least-squares-v1",
    "temperature_unit": "C",
    "ror_unit": "C/min",
    "timestamp_clock": "sidecar-monotonic-seconds",
    "display_ema_alpha": 0.3,
    "et_display_ema_alpha": 0.3,
    "ror_ema_alpha": 0.2,
    "et_ror_ema_alpha": 0.2,
    "ror_window_sec": 30,
    "ror_warmup_reads": 3,
}


async def recorded_reference(duration: int = 85) -> dict:
    """Acquire a declared virtual fixture through the real adapter's read path."""
    clock = [1000.0]
    adapter = live.VirtualMachineAdapter(sim="thermal", clock=lambda: clock[0])
    await adapter.connect()
    assert adapter._model is not None
    adapter._model.bt = 180.0
    source_clock = f"{uuid.uuid4().hex}:1"
    points = []
    try:
        for second in range(duration + 1):
            clock[0] = 1000.0 + second
            reading = await adapter.read()
            points.append({
                "elapsed_sec": float(second), "acquired_at": reading.timestamp,
                "sensor_clock": source_clock, "bt_c": reading.bt,
                "processing": dict(PROCESSING),
            })
            if second == 22:
                await adapter.control(heater=100.0)
            if second == 36:
                await adapter.control(heater=60.0)
    finally:
        await adapter.disconnect()
    return {
        "version": "raw-bt-reference-v1", "source": "recorded_session",
        "source_session_id": f"virtual-recording-{uuid.uuid4()}",
        "source_machine": dict(MACHINE), "temperature_unit": "C",
        "control_filter_version": "raw-bt-dt-ema-v1",
        "charge": {"event_id": "fixture-charge", "elapsed_sec": 0},
        "drop": {"event_id": "fixture-drop", "elapsed_sec": float(duration)},
        "points": points,
    }


class CurveLane:
    def __init__(self, driver, reference: dict):
        self.driver, self.reference = driver, reference
        self.charge = None
        self.authority = None
        self.rows = []
        self.preparation = {
            "adapter": "virtual thermal", "initial_bt_c": 180,
            "heater_before_22s": 0, "heater_after_22s": 100,
            "source": "separate real adapter acquisition with declared logical fixture clock",
            "live_clock": "unmodified sidecar monotonic clock",
        }

    async def status(self):
        result = await self.driver.request("/status")
        live.require(result.status == 200, "status unavailable", result)
        return result.body

    async def charge_now(self, *, backdate=False):
        await self.driver.fresh_connect()
        adapter = self.driver.adapter
        assert adapter._model is not None
        adapter._model.bt = 180.0
        adapter._model_ts = time.monotonic()
        await self.driver.request("/control", {"heater": 0, "origin": "manual"})
        anchor = None
        if backdate:
            reading = await self.driver.request("/temperatures")
            live.require(reading.status == 200, "anchor acquisition failed", reading)
            anchor = {"sensor_clock": reading.body["sensor_clock"], "acquired_at": reading.body["timestamp"]}
            for _ in range(4):
                await asyncio.sleep(0.5)
                await self.driver.request("/temperatures")
        status = await self.status()
        request = {
            "session_id": str(uuid.uuid4()), "sensor_clock": status["sensor_clock"],
            "connection_epoch": status["connection_epoch"],
            "expected_generation": status["heater_control"]["generation"],
            "origin": {"kind": "sample", "sample": anchor} if anchor else {"kind": "now"},
        }
        result = await self.driver.request("/start", request)
        live.require(result.status == 200, "Charge rejected", result)
        self.charge = result.body["charge"]
        if anchor:
            live.require(self.charge["anchor"] == anchor and self.charge["acquired_at"] == anchor["acquired_at"],
                         "backdated Charge changed exact sample key", result)
        self.charge_request = request
        return result

    async def prepare(self, *, backdate=False):
        await self.charge_now(backdate=backdate)
        target = parse_target(self.reference, machine=parse_machine(MACHINE), config=VIRTUAL_CONFIG)
        switched = False
        deadline = time.monotonic() + 42
        while time.monotonic() < deadline:
            temperatures = await self.driver.request("/temperatures")
            live.require(temperatures.status == 200, "acquisition failed", temperatures)
            status = await self.status()
            elapsed = status["server_time"] - self.charge["acquired_at"]
            self.rows.append({"elapsed_sec": elapsed, "temperatures": temperatures.body,
                              "eligibility": status["curve_eligibility"]})
            if elapsed >= 22 and not switched:
                result = await self.driver.request("/control", {"heater": 100, "origin": "manual"})
                live.require(result.status == 200, "manual preparation failed", result)
                switched = True
            if (status["curve_eligibility"]["eligible"]
                    and elapsed >= target.tp.confirmed_elapsed_sec):
                print(json.dumps({"event": "live_tp_qualified", "elapsed_sec": elapsed,
                                  "eligibility": status["curve_eligibility"]}), flush=True)
                return status
            await asyncio.sleep(0.5)
        raise AssertionError("thermal preparation did not qualify live TP within 42 seconds")

    async def start(self, reference=None, request_id=None):
        status = await self.status()
        request = {
            "mode": "curve", "session_id": self.charge["session_id"],
            "charge_id": self.charge["charge_id"], "request_id": request_id or str(uuid.uuid4()),
            "sensor_clock": self.charge["sensor_clock"],
            "connection_epoch": self.charge["connection_epoch"],
            "expected_generation": status["heater_control"]["generation"],
            "machine": dict(MACHINE), "config_id": "virtual-v1",
            "reference": reference or self.reference,
        }
        result = await self.driver.request("/pid/on", request)
        if result.status == 200:
            self.authority = result.body["curve"]["authority"]
        return result, request

    async def follow(self, seconds: float, *, renew=True):
        target = parse_target(self.reference, machine=parse_machine(MACHINE), config=VIRTUAL_CONFIG)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if renew:
                renewed = await self.driver.request("/pid/renew", self.authority)
                if renewed.status == 409:
                    terminal_status = await self.status()
                    terminal_curve = terminal_status["curve"]
                    live.require(terminal_curve is not None and terminal_curve["phase"] == "terminal"
                                 and terminal_curve["reason"] == "reference_exhausted",
                                 "renew rejected before reference termination", terminal_status)
                    return terminal_curve
                live.require(renewed.status == 200, "renew rejected", renewed)
            temperatures = await self.driver.request("/temperatures")
            status = await self.status()
            curve = status["curve"]
            if curve and curve["target_bt_c"] is not None and curve["phase"] == "active":
                expected = target.at(curve["elapsed_sec"])
                live.require(abs(curve["target_bt_c"] - expected) < 0.01,
                             "target differs from server elapsed interpolation", curve)
                permitted = curve["permitted_heat_set"]
                live.require(permitted is None or 0 <= permitted <= 100,
                             "curve command out of bounds", curve)
            row = {"observed_at": time.monotonic(), "curve": curve,
                   "heater_control": status["heater_control"], "temperatures": temperatures.body}
            self.rows.append(row)
            print(json.dumps({"event": "curve_observation", "curve": {
                key: curve[key] for key in ("phase", "runner_state", "elapsed_sec", "target_bt_c",
                    "control_pv_c", "error_c", "requested_heat_set", "permitted_heat_set",
                    "last_applied_heat_set", "reason", "terminal_outcome", "receipt_next_sequence")
            } if curve else None}), flush=True)
            if curve and curve["phase"] == "terminal":
                return curve
            await asyncio.sleep(0.5)
        return (await self.status())["curve"]

    async def stop(self, reason="user"):
        result = await self.driver.request("/pid/off", {
            "mode": "curve", "authority": self.authority, "reason": reason,
        })
        live.require(result.status == 200, "bound stop failed", result)
        return result

    async def receipts(self, after=0, limit=512):
        result = await self.driver.request(
            f"/pid/receipts?charge_id={self.charge['charge_id']}&after={after}&limit={limit}")
        live.require(result.status == 200, "receipt recovery failed", result)
        return result.body


async def rising(lane):
    await lane.prepare()
    result, request = await lane.start()
    live.require(result.status == 200, "eligible curve start failed", result)
    await lane.follow(12)
    await lane.stop()
    return {"start": result.json(), "request": request, "receipts": await lane.receipts()}


async def invalid(lane):
    await lane.charge_now()
    initial = await lane.status()
    cases = {}
    mutations = {
        "synthetic": lambda r: r.update(source="synthetic"),
        "missing_raw": lambda r: r["points"][8].pop("bt_c"),
        "duplicate": lambda r: r["points"].__setitem__(8, copy.deepcopy(r["points"][7])),
        "backward": lambda r: r["points"][8].update(acquired_at=900),
        "nonfinite": lambda r: r["points"][8].update(bt_c=float("nan")),
        "unknown_metadata": lambda r: r["points"][8]["processing"].update(unknown=True),
        "machine_mismatch": lambda r: r["source_machine"].update(machine_id="other"),
    }
    for name, mutate in mutations.items():
        reference = copy.deepcopy(lane.reference)
        mutate(reference)
        result, _ = await lane.start(reference)
        live.require(result.status in (400, 409), f"invalid source {name} admitted", result)
        status = await lane.status()
        live.require(status["heater_control"]["generation"] == initial["heater_control"]["generation"],
                     "invalid reference changed ownership", status)
        cases[name] = result.json()
    return {"cases": cases, "writes": lane.driver.adapter.writes}


async def charge_identity(lane):
    await lane.prepare(backdate=True)
    duplicate = await lane.driver.request("/start", lane.charge_request)
    live.require(duplicate.status == 200 and duplicate.body["charge"] == lane.charge,
                 "duplicate Charge retimed origin", duplicate)
    result, request = await lane.start()
    live.require(result.status == 200, "start failed", result)
    deadline = result.body["curve"]["lease_deadline"]
    duplicate_start = await lane.driver.request("/pid/on", request)
    live.require(duplicate_start.status == 200, "duplicate start failed", duplicate_start)
    live.require(duplicate_start.body["curve"]["authority"] == lane.authority,
                 "duplicate start minted authority", duplicate_start)
    live.require(duplicate_start.body["curve"]["lease_deadline"] == deadline,
                 "start retry renewed lease", duplicate_start)
    conflict = copy.deepcopy(request)
    conflict["reference"]["source_session_id"] = "changed"
    rejected = await lane.driver.request("/pid/on", conflict)
    live.require(rejected.status == 409, "changed idempotency request admitted", rejected)
    await lane.stop()
    return {"duplicate_charge": duplicate.json(), "duplicate_start": duplicate_start.json(),
            "conflict": rejected.json()}


async def tp_gate(lane):
    await lane.charge_now()
    before = len(lane.driver.adapter.writes)
    rejected, _ = await lane.start()
    live.require(rejected.status == 409, "pre-TP start admitted", rejected)
    live.require(len(lane.driver.adapter.writes) == before, "pre-TP command transmitted")
    return {"rejected": rejected.json(), "eligibility": (await lane.status())["curve_eligibility"]}


async def lease_expiry(lane):
    await lane.prepare()
    started, _ = await lane.start()
    live.require(started.status == 200, "start failed", started)
    deadline = started.body["curve"]["lease_deadline"]
    lane.driver.adapter.gate_next_read()
    reading = lane.driver.spawn(lane.driver.request("/temperatures"))
    await asyncio.wait_for(lane.driver.adapter.read_started.wait(), 2)
    await asyncio.sleep(max(0, deadline - time.monotonic()) + 0.15)
    status = await lane.status()
    revoked_at = time.monotonic()
    live.require(status["heater_control"]["generation"] > lane.authority["generation"],
                 "blocked read retained expired authority", status)
    live.require(status["curve"]["reason"] == "lease_expired", "expiry reason missing", status)
    live.require(revoked_at <= deadline + 0.25, "lease revocation exceeded 250 ms budget")
    stale = await lane.driver.request("/pid/renew", lane.authority)
    live.require(stale.status == 409, "expired renewal revived run", stale)
    lane.driver.adapter.release_gates()
    await reading
    await asyncio.sleep(0.05)
    return {"deadline": deadline, "revoked_observed_at": revoked_at,
            "status": status, "stale_renew": stale.json(), "receipts": await lane.receipts()}


async def takeover(lane):
    await lane.prepare()
    started, _ = await lane.start()
    live.require(started.status == 200, "start failed", started)
    await lane.follow(2)
    response = await lane.driver.request("/control", {"heater": 37, "origin": "manual", "takeover": True})
    live.require(response.status == 200, "takeover failed", response)
    live.require(lane.driver.adapter._cmd["heater"] == 37, "manual command absent")
    stale = await lane.driver.request("/pid/renew", lane.authority)
    live.require(stale.status == 409, "takeover run renewed", stale)
    independent = await lane.driver.request("/control", {"fan": 21, "drum": 44, "origin": "manual"})
    live.require(independent.status == 200, "nonheater controls failed", independent)
    return {"takeover": response.json(), "independent": independent.json(),
            "status": await lane.status(), "receipts": await lane.receipts()}


async def terminal(lane):
    lane.reference = await recorded_reference(38)
    await lane.prepare()
    started, _ = await lane.start()
    live.require(started.status == 200, "start failed", started)
    curve = await lane.follow(14)
    live.require(curve["reason"] == "reference_exhausted", "reference did not end", curve)
    live.require(lane.driver.adapter._cmd["heater"] == 0, "terminal minimum absent")
    status = await lane.status()
    live.require(status["charge"]["state"] == "open", "exhaustion invented Drop", status)
    stale = await lane.driver.request("/pid/renew", lane.authority)
    live.require(stale.status == 409, "terminal run revived", stale)
    return {"curve": curve, "receipts": await lane.receipts(), "status": status}


async def recovery(lane):
    result = await takeover(lane)
    for index in range(700):
        response = await lane.driver.request("/control", {"heater": index % 100, "origin": "manual"})
        live.require(response.status == 200, "overflow fixture command failed", response)
    page = await lane.receipts(0)
    live.require(page["gap"] is not None, "overflow silently lost receipts", page)
    sequences = [receipt["sequence"] for receipt in page["receipts"]]
    live.require(sequences == sorted(set(sequences)), "receipt sequences duplicated or reordered")
    all_receipts = list(page["receipts"])
    while page["has_more"]:
        page = await lane.receipts(page["next_after"])
        all_receipts.extend(page["receipts"])
    live.require(len(all_receipts) == 2048, "bounded journal retained wrong count", len(all_receipts))
    result["overflow"] = {"first_available": all_receipts[0]["sequence"],
                          "last": all_receipts[-1]["sequence"], "retained": len(all_receipts)}
    return result


async def fixed_regression(lane):
    result = await live.scenario_manual_fixed(lane.driver)
    result["parent_evidence"] = "/tmp/swarm-fsd02/parent/fsd01-live.json"
    return result


async def pending_drop(lane):
    await lane.prepare()
    started, _ = await lane.start()
    live.require(started.status == 200, "start failed", started)
    adapter = lane.driver.adapter
    adapter.gate_next_write()
    await asyncio.wait_for(adapter.write_started.wait(), 2)
    stopped = lane.driver.spawn(lane.driver.request("/pid/off", {
        "mode": "curve", "authority": lane.authority, "reason": "drop",
    }))
    await asyncio.sleep(0.1)
    live.require(not stopped.done(), "Drop acknowledged before retained writer completed")
    status = await lane.status()
    live.require(status["charge"]["state"] == "closed", "Drop did not close Charge", status)
    live.require(status["heater_control"]["generation"] > lane.authority["generation"],
                 "Drop did not synchronously revoke", status)
    next_charge = {**lane.charge_request, "session_id": str(uuid.uuid4()),
                   "expected_generation": status["heater_control"]["generation"], "origin": {"kind": "now"}}
    rejected = await lane.driver.request("/start", next_charge)
    live.require(rejected.status == 409, "new Charge replaced unresolved terminal context", rejected)
    adapter.release_gates()
    finished = await stopped
    live.require(finished.status == 200, "Drop did not complete after drain", finished)
    live.require(adapter._cmd["heater"] == 0, "Drop minimum not applied")
    page = await lane.receipts()
    terminal_receipts = [row for row in page["receipts"] if row["purpose"] == "terminal"]
    live.require(terminal_receipts and all(row["charge_id"] == lane.charge["charge_id"]
                 and row["run_id"] == lane.authority["run_id"] for row in terminal_receipts),
                 "terminal receipt lost original identity", terminal_receipts)
    return {"stop": finished.json(), "rejected_new_charge": rejected.json(), "receipts": page}


LANES = {
    "curve_mode_regression": fixed_regression,
    "rising_target": rising, "reference_rejected": invalid,
    "charge_identity": charge_identity, "tp_gate": tp_gate,
    "lease_expiry": lease_expiry, "manual_takeover": takeover,
    "terminal_boundary": terminal, "receipt_recovery": recovery,
    "drop_pending_io": pending_drop,
}


async def main_async(args):
    logger = logging.getLogger("fsd02-live")
    handler = logging.FileHandler(args.output.with_suffix(".log"), mode="w")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    reference = await recorded_reference()
    parse_target(reference, machine=parse_machine(MACHINE), config=VIRTUAL_CONFIG)
    report = {
        "contract": "FSD-02", "parent": "4787aeb7d6d7db826d44a5e1eb71ed3888e7c131",
        "head": live.git_output("rev-parse", "HEAD"), "source_before": source_hashes(),
        "reference": reference, "lanes": [], "started_at": time.time(),
    }
    for name in args.lane or list(LANES):
        print(json.dumps({"event": "lane_started", "lane": name}), flush=True)
        lane_result = {"name": name, "status": "fail"}
        try:
            async with live.LiveDriver(logger) as driver:
                lane = CurveLane(driver, copy.deepcopy(reference))
                lane_result["server"] = {"host": "127.0.0.1", "port": driver.port}
                lane_result["result"] = await LANES[name](lane)
                lane_result["rows"] = lane.rows
                lane_result["preparation"] = lane.preparation
                lane_result["requests"] = driver.requests
                lane_result["writes"] = driver.adapter.writes
            lane_result["cleanup"] = driver.cleanup
            live.require(not any(driver.cleanup.values()), "owned process cleanup incomplete", driver.cleanup)
            lane_result["status"] = "pass"
        except Exception:
            lane_result["error"] = traceback.format_exc()
            print(lane_result["error"], flush=True)
        report["lanes"].append(lane_result)
        print(json.dumps({"event": "lane_completed", "lane": name, "status": lane_result["status"]}), flush=True)
        write_report(args.output, report)
    report["source_after"] = source_hashes()
    report["source_stable"] = report["source_before"] == report["source_after"]
    report["passed"] = report["source_stable"] and all(row["status"] == "pass" for row in report["lanes"])
    report["finished_at"] = time.time()
    write_report(args.output, report)
    print(json.dumps({"passed": report["passed"], "output": str(args.output)}), flush=True)
    return 0 if report["passed"] else 1


def source_hashes():
    paths = list((ROOT / "src-tauri/sidecar").glob("*.py"))
    paths.extend((ROOT / "src-tauri/sidecar/adapters").glob("*.py"))
    paths.extend([Path(__file__).resolve(), ROOT / "scripts/verify-fsd.py"])
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def write_report(path, report):
    encoded = json.dumps(report, default=str)
    safe = json.loads(encoded, parse_constant=lambda value: f"rejected-nonfinite:{value}")
    path.write_text(json.dumps(safe, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lane", action="append", choices=tuple(LANES))
    parser.add_argument("--output", type=Path, default=Path("/tmp/swarm-fsd02/live.json"))
    options = parser.parse_args()
    options.output.parent.mkdir(parents=True, exist_ok=True)
    raise SystemExit(asyncio.run(main_async(options)))

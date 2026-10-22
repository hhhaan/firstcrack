"""Heater authority and completion barriers for a single connection."""

import asyncio
from dataclasses import dataclass, asdict, replace
from collections import deque
from copy import deepcopy
import hashlib
import json
import math
import time
import uuid
import logging
from typing import Any, Awaitable, Callable, Literal

import config
from control_guard import ControlUnavailable, clamp_command
from pid import PidGains
from pid_runner import PidRunner, PvSample, STOP_HOLD, STOP_ZERO, CurveRuntime
from roast_target import (MachineIdentity, RawObservation, RawTpState, ControlFilter,
                          RoastTarget, CurveConfig, VIRTUAL_CONFIG, parse_target,
                          parse_processing, parse_machine, parse_clock, advance_filter,
                          advance_tp, TargetValidationError)

_log = logging.getLogger(__name__)
Origin = Literal["manual", "replay", "pid", "safety"]


@dataclass(frozen=True)
class HeaterTicket:
    connection_epoch: int
    generation: int
    origin: Origin


class CurveError(ControlUnavailable):
    def __init__(self, code: str, message: str | None = None, *, status: int = 409):
        super().__init__(message or code)
        self.code, self.status = code, status


def _object(value: Any, keys: set[str], field: str = "request") -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise CurveError("invalid_request", f"Invalid {field} fields", status=400)
    return value


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise CurveError("invalid_request", "Invalid identifier", status=400)
    return value


def _integer(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CurveError("invalid_request", "Expected nonnegative integer", status=400)
    return value


@dataclass(frozen=True)
class FixedOperation:
    pass


@dataclass(frozen=True)
class CurveOperation:
    charge_id: str
    request_id: str
    run_id: str
    target: RoastTarget
    config: CurveConfig
    lease_deadline: float
    authority: dict[str, Any]
    reason: str | None = None
    terminal_outcome: str = "none"


@dataclass(frozen=True)
class PidOperation:
    ticket: HeaterTicket
    runner: PidRunner
    phase: Literal["starting", "active", "stopping", "fault"]
    mode: FixedOperation | CurveOperation = FixedOperation()


class ControlUncertain(TimeoutError):
    """A submitted writer has not completed; its physical outcome is unknown."""


class HeaterControlSession:
    def __init__(self, *, epoch: Callable[[], int], adapter: Callable[[], Any],
                 available: Callable[[], bool], read_pv: Callable[[], Awaitable[PvSample]],
                 read_feedback: Callable[[], Awaitable[float | None]],
                 applied: Callable[[dict[str, float]], None],
                 limits: Callable[[], dict[str, dict[str, Any]]],
                 machine: Callable[[], MachineIdentity | None] = lambda: None,
                 sensor_clock: Callable[[], str] = lambda: "",
                 curve_capability: Callable[[], dict[str, Any]] = lambda: {"supported": False},
                 read_raw: Callable[[], Awaitable[PvSample]] | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._machine = machine
        self._sensor_clock = sensor_clock
        self._curve_capability = curve_capability
        self._read_raw = read_raw or read_pv
        self._charge: dict[str, Any] | None = None
        self._charge_request: dict[str, Any] | None = None
        self._charge_failed = False
        self._history: deque[dict[str, Any]] = deque(maxlen=2048)
        self._filtered: ControlFilter | None = None
        self._tp = RawTpState()
        self._journals: dict[str, dict[str, Any]] = {}
        self._requests: dict[tuple[str, str], tuple[str, str]] = {}
        self._runs: dict[str, dict[str, Any]] = {}
        self._last_curve: dict[str, Any] | None = None
        self._lease_handle: asyncio.TimerHandle | None = None
        self._terminal_tasks: set[asyncio.Task[Any]] = set()
        self._terminal_task: tuple[HeaterTicket, asyncio.Task[Any]] | None = None
        self._last_applied_heat: tuple[float, float, int] | None = None
        self._last_transmitted_heat: tuple[float, float, int] | None = None
        self._uncertain_seed_epoch: int | None = None
        self._epoch = epoch
        self._adapter = adapter
        self._available = available
        self._read_pv = read_pv
        self._read_feedback = read_feedback
        self._applied = applied
        self._limits = limits
        self.ticket = HeaterTicket(epoch(), 0, "manual")
        self.runner: PidRunner | None = None
        self.task: asyncio.Task[None] | None = None
        self._writers: set[asyncio.Task[None]] = set()
        self._command = 0
        self._request: tuple[HeaterTicket, float, int] | None = None
        self._retries = 0
        self.barrier_timeout = 2.0
        self._uncertain = False
        self._operation: PidOperation | None = None

    def state(self) -> dict[str, Any]:
        return {**asdict(self.ticket), "connection_epoch": self._epoch(),
                "pending_writes": len(self._writers), "uncertain": self._uncertain,
                "starting": self._operation is not None and self._operation.phase == "starting",
                "stopping": self._operation is not None and self._operation.phase == "stopping"}

    def owns(self, ticket: HeaterTicket) -> bool:
        return ticket == self.ticket and ticket.connection_epoch == self._epoch()

    def current(self, ticket: HeaterTicket) -> bool:
        operation = self._operation
        if (operation is not None and operation.ticket == ticket
                and isinstance(operation.mode, CurveOperation)
                and operation.phase in ("starting", "active")):
            charge = self._charge
            if (charge is None or charge["state"] != "open"
                    or self._clock() >= min(operation.mode.lease_deadline,
                                            charge["acquired_at"] + operation.mode.target.end_sec)):
                return False
        return self._available() and self.owns(ticket)

    def _check(self, ticket: HeaterTicket) -> None:
        if not self.current(ticket):
            raise ControlUnavailable("Heater ownership or connection changed.")

    def revoke(self, origin: Origin = "manual") -> HeaterTicket:
        self.ticket = HeaterTicket(self._epoch(), self.ticket.generation + 1, origin)
        self._request = None
        self._command += 1
        if self.task is not None and self.task is not asyncio.current_task():
            self.task.cancel()
            self.task = None
        return self.ticket

    async def drain(self) -> None:
        if self._writers:
            _, pending = await asyncio.wait(tuple(self._writers), timeout=self.barrier_timeout)
            if pending:
                self._uncertain = True
                raise ControlUncertain("Heater write still pending; takeover is not acknowledged.")
        self._uncertain = False

    async def retire_connection(self) -> None:
        """Retire controller duty after connection admission closes and writers finish."""
        self.close_charge("disconnected")
        self.revoke()
        if self._lease_handle is not None:
            self._lease_handle.cancel()
        await self.drain()
        self._operation = None
        self.runner = None
        self._charge = None
        self._history.clear()
        self._journals.clear()
        self._requests.clear()
        self._runs.clear()
        self._last_curve = None
        self._last_applied_heat = None
        self._last_transmitted_heat = None
        self._uncertain_seed_epoch = None

    async def _write(self, values: dict[str, float], ticket: HeaterTicket | None,
                     *, retry: bool = False, command: int | None = None) -> dict[str, float]:
        values = clamp_command(values, self._limits())
        adapter, epoch = self._adapter(), self._epoch()
        attempt = self._attempt(values, ticket)
        uncertainty: int | None = None
        observed = False

        def observe(evidence: str, acknowledged: float) -> None:
            nonlocal observed
            observed = True
            # Superseded transmissions still define the actuator seed, not current-only UI state.
            if self._epoch() == epoch and self._adapter() is adapter:
                self._last_transmitted_heat = (acknowledged, self._clock(), epoch)
                self._uncertain_seed_epoch = None
            if attempt is not None:
                self._append_receipt(attempt, event="transmitted", evidence=evidence,
                                     acknowledged_heat_set=acknowledged, outcome="succeeded")


        def is_current() -> bool:
            return (self._available() and self._adapter() is adapter and self._epoch() == epoch
                    and (ticket is None or self.current(ticket))
                    and (command is None or self._command == command))

        async def write() -> None:
            if not is_current():
                if attempt is not None:
                    self._append_receipt(attempt, event="rejected", outcome="rejected", reason="stale_authority")
                raise ControlUnavailable("Control ownership changed before write.")
            try:
                kwargs: dict[str, Any] = {"_is_current": is_current, "_confirm_first": retry}
                if "heater" in values:
                    kwargs["_heater_observer"] = observe
                await adapter.control(**values, **kwargs)
            except Exception as exc:
                if ("heater" in values and (observed or not isinstance(exc, ControlUnavailable))
                        and self._epoch() == epoch and self._adapter() is adapter):
                    self._uncertain_seed_epoch = epoch
                if attempt is not None:
                    event = "uncertain" if observed or not isinstance(exc, ControlUnavailable) else "rejected"
                    self._append_receipt(attempt, event="reconciliation" if uncertainty else event,
                                         outcome="failed" if uncertainty else event,
                                         reconciles_sequence=uncertainty, reason="write_fault")
                raise
            if "heater" in values and not observed and self._epoch() == epoch and self._adapter() is adapter:
                self._last_transmitted_heat = (values["heater"], self._clock(), epoch)
                self._uncertain_seed_epoch = None
            if attempt is not None:
                self._append_receipt(attempt, event="reconciliation" if uncertainty else "completed",
                                     reconciles_sequence=uncertainty, outcome="succeeded")
            if is_current():
                self._applied(values)
                if "heater" in values:
                    self._last_applied_heat = (values["heater"], self._clock(), epoch)

        task = asyncio.create_task(write())
        self._writers.add(task)
        def completed(done: asyncio.Task[None]) -> None:
            self._writers.discard(done)
            if not done.cancelled():
                done.exception()
        task.add_done_callback(completed)
        try:
            await asyncio.wait_for(asyncio.shield(task), self.barrier_timeout)
        except TimeoutError as exc:
            if task.done():
                raise
            self._uncertain = True
            if attempt is not None:
                uncertainty = self._append_receipt(attempt, event="uncertain", outcome="uncertain", reason="write_uncertain")["sequence"]
            raise ControlUncertain("Submitted control write has an uncertain outcome.") from exc
        if not is_current():
            raise ControlUnavailable("Control ownership changed during write.")
        return values

    async def claim_replay(self, epoch: int, generation: int) -> HeaterTicket:
        if (epoch != self._epoch() or generation != self.ticket.generation
                or self.ticket.origin not in ("manual", "replay") or self._uncertain or self.is_curve()):
            raise ControlUnavailable("Replay activation is stale or heater is owned.")
        ticket = self.revoke("replay")
        self._operation = None
        await self.drain()
        self._check(ticket)
        return ticket

    async def release_replay(self, epoch: int, generation: int) -> None:
        ticket = HeaterTicket(epoch, generation, "replay")
        self._check(ticket)
        released = self.revoke()
        await self.drain()
        self._check(released)

    async def control(self, values: dict[str, float], *, origin: str = "manual",
                      takeover: bool = False, generation: int | None = None,
                      connection_epoch: int | None = None, retry_epoch: int | None = None) -> dict[str, float]:
        if "heater" not in values:
            return await self._write(values, None)
        if origin == "replay":
            ticket = HeaterTicket(connection_epoch, generation, "replay")
            self._check(ticket)
        elif retry_epoch is not None:
            ticket = self.ticket
            if ticket.origin != "manual":
                raise ControlUnavailable("Manual retry lost heater ownership.")
        else:
            if self.ticket.origin != "manual" and not takeover:
                raise ControlUnavailable("Automatic heater ownership requires explicit manual takeover.")
            prior_curve = self._operation if self.is_curve() else None
            ticket = self.revoke()
            if prior_curve is not None:
                self._operation = replace(prior_curve, ticket=ticket, phase="stopping",
                                          mode=replace(prior_curve.mode, reason=prior_curve.mode.reason or "manual_takeover", terminal_outcome="pending"))
            else:
                self._operation = None
            if self.runner is not None:
                self.runner.invalidate()
            await self.drain()
            self._check(ticket)
        if self._uncertain:
            raise ControlUncertain("Previous heater write remains uncertain.")
        if retry_epoch is not None:
            if (retry_epoch != self._epoch() or set(values) != {"heater"}
                    or self._request != (ticket, values["heater"], self._command) or self._retries >= 2):
                raise ControlUnavailable("Retry does not match the current heater command.")
            self._retries += 1
        else:
            self._command += 1
            self._request = (ticket, values["heater"], self._command)
            self._retries = 0
        try:
            result = await self._write(values, ticket, retry=retry_epoch is not None, command=self._command)
        except Exception:
            if self.is_curve() and self.owns(ticket):
                op = self._operation
                self._operation = replace(op, phase="fault", mode=replace(op.mode, terminal_outcome="uncertain" if self._uncertain else "failed"))
            raise
        if self.is_curve() and self.owns(ticket) and ticket.origin == "manual":
            self._complete_curve(self._operation)
        return result

    async def start_fixed(self, sv: float, gains: PidGains) -> dict[str, Any]:
        if self._uncertain:
            raise ControlUncertain("Previous heater write remains uncertain.")
        if self.is_curve():
            raise CurveError("stale_authority", "Curve owns the heater")
        ticket = self.revoke("pid")
        if self.runner is not None:
            self.runner.invalidate()
        final_ticket: HeaterTicket | None = None

        async def write(duty: float) -> None:
            self._check(ticket)
            await self._write({"heater": duty}, ticket)

        async def finalize(duty: float) -> None:
            nonlocal final_ticket
            if final_ticket is None:
                self._check(ticket)
                final_ticket = self.revoke("safety")
                self._operation = PidOperation(final_ticket, runner, "fault")
            await self.drain()
            self._check(final_ticket)
            await self._write({"heater": duty}, final_ticket)

        runner = PidRunner(read_pv=self._read_pv, read_feedback=self._read_feedback,
                           write_duty=write, write_final=finalize, gains=gains,
                           is_current=lambda: self.owns(ticket))
        self.runner = runner
        self._operation = PidOperation(ticket, runner, "starting")
        try:
            await self.drain()
            self._check(ticket)
            await runner.start(sv)
            self._check(ticket)
        except (Exception, asyncio.CancelledError):
            if self.runner is runner and self.owns(ticket):
                runner.invalidate("PID 시작이 완료되지 않았습니다. 머신 연결과 화력을 확인하세요.")
                self._operation = PidOperation(ticket, runner, "fault")
            raise
        self._operation = PidOperation(ticket, runner, "active")
        self.task = asyncio.create_task(self._loop(runner, ticket))
        return runner.state()

    async def _loop(self, runner: PidRunner, ticket: HeaterTicket) -> None:
        while self.owns(ticket) and runner.state_name in ("running", "holding"):
            await asyncio.sleep(config.PID_TICK_S)
            try:
                await runner.tick()
            except Exception:
                _log.exception("PID tick failed")

    async def stop(self, reason: str = "user", *, mode: str = STOP_HOLD,
                   clear: bool = False) -> dict[str, Any]:
        operation = self._operation
        if operation is not None and isinstance(operation.mode, CurveOperation):
            await self._end_curve(reason if reason != "disconnect" else "disconnected")
            if clear:
                self.runner = None
            return operation.runner.state()
        runner = operation.runner if operation is not None else self.runner
        ticket = self.revoke("safety")
        if operation is not None:
            self._operation = PidOperation(ticket, operation.runner, "stopping")
        try:
            await self.drain()
            if not self.owns(ticket):
                raise ControlUnavailable("Terminal command was superseded.")
            if operation is not None:
                self._check(ticket)
                async def final_write(duty: float) -> None:
                    self._check(ticket)
                    await self._write({"heater": duty}, ticket)
                await operation.runner.stop(reason, mode=mode, write_final=final_write, force=True)
                self._check(ticket)
            state = runner.state() if runner is not None else {"state": "off", "error": None}
            self._operation = None
            self.revoke()
            if clear:
                self.runner = None
            return state
        except (Exception, asyncio.CancelledError):
            if operation is not None and self.owns(ticket):
                operation.runner.invalidate("PID 해제가 완료되지 않았습니다. 머신 연결과 화력을 확인하세요.")
            raise


    def is_curve(self) -> bool:
        return self._operation is not None and isinstance(self._operation.mode, CurveOperation)

    def observe_raw(self, payload: dict[str, Any]) -> None:
        if payload.get("stale") or payload.get("bt_raw") is None:
            return
        try:
            parse_processing(payload["processing"])
            clock = parse_clock(payload["sensor_clock"])
            bt, stamp = payload["bt_raw"], payload["timestamp"]
            if (isinstance(bt, bool) or not isinstance(bt, (int, float))
                    or not math.isfinite(bt) or not math.isfinite(stamp)):
                return
        except (KeyError, ValueError):
            return
        if clock != self._sensor_clock():
            return
        if self._history and self._history[-1]["sensor_clock"] != clock:
            self._history.clear()
            self.close_charge("disconnected")
        if self._history and stamp <= self._history[-1]["timestamp"]:
            return
        self._history.append(deepcopy(payload))
        self._prune_history()
        if self._charge is not None and self._charge["state"] == "open":
            if clock != self._charge["sensor_clock"]:
                self.close_charge("disconnected")
            elif stamp >= self._charge["acquired_at"]:
                self._advance_raw(payload)

    def _prune_history(self) -> None:
        cutoff = self._clock() - 120
        while self._history and self._history[0]["timestamp"] < cutoff:
            self._history.popleft()

    def _advance_raw(self, payload: dict[str, Any]) -> None:
        assert self._charge is not None
        sample = RawObservation(payload["sensor_clock"], payload["timestamp"],
                                payload["timestamp"] - self._charge["acquired_at"], payload["bt_raw"])
        if 0 <= sample.bt_c <= 260:
            self._filtered = advance_filter(self._filtered, sample)
            self._tp = advance_tp(self._tp, sample)

    def accept_charge(self, value: Any) -> tuple[dict[str, Any], bool]:
        body = _object(value, {"session_id", "sensor_clock", "connection_epoch", "expected_generation", "origin"})
        _identifier(body["session_id"])
        clock = parse_clock(body["sensor_clock"])
        _integer(body["connection_epoch"])
        _integer(body["expected_generation"])
        origin = body["origin"]
        if not isinstance(origin, dict) or origin.get("kind") not in ("now", "sample"):
            raise CurveError("invalid_request", status=400)
        _object(origin, {"kind"} if origin["kind"] == "now" else {"kind", "sample"}, "origin")
        if origin["kind"] == "sample":
            sample = _object(origin["sample"], {"sensor_clock", "acquired_at"}, "sample")
            parse_clock(sample["sensor_clock"])
            stamp = sample["acquired_at"]
            if isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
                raise CurveError("invalid_request", status=400)
        if clock != self._sensor_clock() or body["connection_epoch"] != self._epoch():
            raise CurveError("stale_authority")
        if self._charge is not None and self._charge["session_id"] == body["session_id"]:
            if self._charge_request != {"session_id": body["session_id"], "origin": origin}:
                raise CurveError("charge_conflict")
            if self._charge_failed:
                raise CurveError("charge_closed", "Charge adapter notification failed")
            return self.charge_response(), False
        if any(journal["session_id"] == body["session_id"] for journal in self._journals.values()):
            raise CurveError("charge_conflict")
        if self._charge is not None and self._charge["state"] == "open":
            raise CurveError("charge_conflict")
        if self._charge is not None and (self._operation is not None or self._writers
                                        or any(not task.done() for task in self._terminal_tasks)):
            raise CurveError("stale_authority", "Previous Charge still has unfinished control work")
        if body["expected_generation"] != self.ticket.generation or not self._available():
            raise CurveError("stale_authority")
        machine = self._machine()
        if machine is None:
            raise CurveError("machine_mismatch")
        now = self._clock()
        anchor = None
        acquired_at = now
        self._prune_history()
        if origin["kind"] == "sample":
            anchor = origin["sample"]
            retained = next((row for row in self._history
                             if row["sensor_clock"] == anchor["sensor_clock"]
                             and row["timestamp"] == anchor["acquired_at"]), None)
            if retained is None or anchor["sensor_clock"] != clock or not 0 <= now - anchor["acquired_at"] <= 120:
                raise CurveError("charge_anchor_missing")
            acquired_at = anchor["acquired_at"]
        charge_id = str(uuid.uuid4())
        self._charge = {"session_id": body["session_id"], "charge_id": charge_id,
                        "machine": asdict(machine), "sensor_clock": clock,
                        "connection_epoch": self._epoch(), "acquired_at": acquired_at,
                        "anchor": deepcopy(anchor), "origin_kind": origin["kind"],
                        "accepted_at": now, "state": "open", "closed_reason": None}
        self._charge_request = {"session_id": body["session_id"], "origin": deepcopy(origin)}
        self._charge_failed = False
        self._filtered, self._tp = None, RawTpState()
        self._journals[charge_id] = {"session_id": body["session_id"], "entries": deque(maxlen=2048), "next": 1}
        for row in self._history:
            if row["sensor_clock"] == clock and row["timestamp"] >= acquired_at:
                self._advance_raw(row)
        return self.charge_response(), True

    def charge_response(self) -> dict[str, Any]:
        now = self._clock()
        return {"ok": True, "charge": deepcopy(self._charge), "server_time": now,
                "elapsed_sec": now - self._charge["acquired_at"] if self._charge else None}

    def charge_notification_failed(self) -> None:
        self._charge_failed = True
        self.close_charge("start_failed")

    def close_charge(self, reason: str) -> None:
        if self._charge is not None and self._charge["state"] == "open":
            self._charge = {**self._charge, "state": "closed", "closed_reason": reason}

    def eligibility(self) -> dict[str, Any]:
        filtered = self._filtered
        warmup = filtered.warmup_remaining_sec if filtered else 10.0
        tp = asdict(self._tp.qualified) if self._tp.qualified else None
        if self._charge is None:
            reason = "no_charge"
        elif self._charge["sensor_clock"] != self._sensor_clock():
            reason = "connection_changed"
        elif self._charge["state"] != "open" or self._charge_failed:
            reason = "charge_closed"
        elif filtered is None or not 0 <= self._clock() - filtered.sample.acquired_at <= 3:
            reason = "sample_stale"
        elif warmup > 0:
            reason = "warming"
        elif tp is None:
            reason = "live_tp_pending"
        else:
            reason = "ready"
        return {"eligible": reason == "ready", "reason": reason,
                "warmup_remaining_sec": warmup, "live_tp": tp}

    def status_fields(self) -> dict[str, Any]:
        self._prune_history()
        return {"server_time": self._clock(), "sensor_clock": self._sensor_clock(),
                "charge": deepcopy(self._charge), "curve": self.curve_snapshot(),
                "curve_eligibility": self.eligibility(),
                "charge_history_oldest_at": self._history[0]["timestamp"] if self._history else None}

    def curve_snapshot(self) -> dict[str, Any] | None:
        if not self.is_curve():
            return deepcopy(self._last_curve)
        operation = self._operation
        curve = operation.mode
        charge = self._charge
        assert charge is not None
        now = self._clock()
        elapsed = now - charge["acquired_at"]
        filtered = self._filtered
        target = curve.target.at(elapsed) if curve.target.points[0].elapsed_sec <= elapsed < curve.target.end_sec else None
        pv = filtered.value if filtered else None
        sample = {"sensor_clock": filtered.sample.clock, "acquired_at": filtered.sample.acquired_at} if filtered else None
        applied = self._last_applied_heat
        feedback = self._history[-1].get("heater") if self._history else None
        return {"mode": "curve", "authority": deepcopy(curve.authority), "request_id": curve.request_id,
                "phase": operation.phase, "runner_state": operation.runner.state_name,
                "reason": curve.reason, "terminal_outcome": curve.terminal_outcome,
                "config_id": curve.config.config_id, "reference_digest": curve.target.digest,
                "source_session_id": curve.target.source_session_id,
                "control_filter_version": curve.config.control_filter_version,
                "elapsed_sec": elapsed, "target_bt_c": target, "control_pv_c": pv,
                "error_c": target - pv if target is not None and pv is not None else None,
                "sample": sample, "sample_age_sec": now - filtered.sample.acquired_at if filtered else None,
                "warmup_remaining_sec": filtered.warmup_remaining_sec if filtered else 10,
                "live_tp": asdict(self._tp.qualified) if self._tp.qualified else None,
                "reference_tp": asdict(curve.target.tp), "reference_drop_sec": curve.target.drop_sec,
                "target_end_sec": curve.target.end_sec,
                "requested_heat_set": operation.runner.requested_output,
                "permitted_heat_set": operation.runner._last_duty,
                "last_applied_heat_set": applied[0] if applied and applied[2] == self._epoch() else None,
                "heat_feedback": feedback, "lease_deadline": curve.lease_deadline if operation.phase in ("starting", "active") else None,
                "pending_writes": len(self._writers), "uncertain": self._uncertain,
                "receipt_next_sequence": self._journals[curve.charge_id]["next"]}

    def _curve_reply(self, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"ok": True, "pid": self.runner.state() if self.runner else None,
                "curve": snapshot if snapshot is not None else self.curve_snapshot(), "server_time": self._clock()}

    async def start_curve(self, value: Any) -> dict[str, Any]:
        body = _object(value, {"mode", "session_id", "charge_id", "request_id", "sensor_clock",
                               "connection_epoch", "expected_generation", "machine", "config_id", "reference"})
        if body["mode"] != "curve" or body["config_id"] != "virtual-v1":
            raise CurveError("invalid_request", status=400)
        for key in ("session_id", "charge_id", "request_id"):
            _identifier(body[key])
        clock = parse_clock(body["sensor_clock"])
        epoch = _integer(body["connection_epoch"])
        generation = _integer(body["expected_generation"])
        machine = parse_machine(body["machine"])
        target = parse_target(body["reference"], machine=machine, config=VIRTUAL_CONFIG)
        canonical = {**body, "reference": target.digest}
        digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        key = (body["charge_id"], body["request_id"])
        if clock != self._sensor_clock() or epoch != self._epoch():
            raise CurveError("stale_authority")
        previous = self._requests.get(key)
        if previous is not None:
            if previous[0] != digest:
                raise CurveError("request_conflict")
            snapshot = self.curve_snapshot() if self.is_curve() and self._operation.mode.run_id == previous[1] else deepcopy(self._runs[previous[1]])
            return self._curve_reply(snapshot)
        if self._uncertain:
            raise ControlUncertain("Previous heater write remains uncertain.")
        if (generation != self.ticket.generation or not self._available()
                or self._operation is not None or self.ticket.origin not in ("manual", "safety")):
            raise CurveError("stale_authority")
        charge = self._charge
        if charge is None or charge["session_id"] != body["session_id"] or charge["charge_id"] != body["charge_id"]:
            raise CurveError("charge_closed")
        if self._machine() != machine or charge["machine"] != asdict(machine):
            raise CurveError("machine_mismatch")
        if not self._curve_capability()["supported"]:
            raise CurveError("unsupported_curve")
        eligibility = self.eligibility()
        if not eligibility["eligible"]:
            code = {"warming": "filter_warming", "live_tp_pending": "tp_pending"}.get(eligibility["reason"], eligibility["reason"])
            raise CurveError(code)
        now = self._clock()
        elapsed = now - charge["acquired_at"]
        latest = self._history[-1] if self._history else {}
        if latest.get("bt_raw", -1) < 0 or latest.get("bt_raw", 261) > 260:
            raise CurveError("sample_fault")
        if elapsed >= target.end_sec:
            raise CurveError("reference_exhausted")
        if elapsed < target.tp.confirmed_elapsed_sec:
            raise CurveError("tp_pending")
        assert self._filtered is not None
        if abs(target.at(elapsed) - self._filtered.value) > VIRTUAL_CONFIG.initial_error_c:
            raise CurveError("initial_error")
        self._curve_seed()
        ticket = self.revoke("pid")
        run_id = str(uuid.uuid4())
        authority = {"session_id": charge["session_id"], "charge_id": charge["charge_id"], "run_id": run_id,
                     "sensor_clock": clock, "connection_epoch": epoch, "generation": ticket.generation}
        curve = CurveOperation(charge["charge_id"], body["request_id"], run_id, target, VIRTUAL_CONFIG,
                               now + VIRTUAL_CONFIG.lease_sec, authority)
        async def write(duty: float) -> None:
            self._check(ticket)
            await self._write({"heater": duty}, ticket)
        async def terminate(reason: str) -> None:
            if self.owns(ticket):
                await self._end_curve(reason)
        runner = PidRunner(read_pv=self._read_raw, write_duty=write,
                           gains=PidGains(kp=curve.config.kp, ki=curve.config.ki, kd=curve.config.kd),
                           clock=self._clock, is_current=lambda: self.current(ticket),
                           curve=CurveRuntime(target, curve.config, charge["acquired_at"], lambda: self._filtered, terminate))
        self.runner = runner
        self._operation = PidOperation(ticket, runner, "starting", curve)
        self._requests[key] = (digest, run_id)
        self._schedule_lease()
        try:
            await self.drain()
            self._check(ticket)
            seed = self._curve_seed()
            runner.start_curve(seed[0], seed[1])
            self._check(ticket)
        except (Exception, asyncio.CancelledError):
            if self.owns(ticket):
                self._begin_curve_end("start_failed")
            raise
        self._operation = replace(self._operation, phase="active")
        self.task = asyncio.create_task(self._curve_loop(runner, ticket))
        return self._curve_reply()

    def _curve_seed(self) -> tuple[float, float, int]:
        epoch, now = self._epoch(), self._clock()
        if self._uncertain_seed_epoch == epoch:
            raise CurveError("seed_unavailable")
        seed = self._last_transmitted_heat
        if seed is None or seed[2] != epoch:
            row = self._history[-1] if self._history else {}
            feedback = row.get("heater")
            if (isinstance(feedback, bool) or not isinstance(feedback, (int, float))
                    or not math.isfinite(feedback) or not 0 <= feedback <= 100
                    or row.get("processing", {}).get("read_units", {}).get("heater", "%") != "%"
                    or not 0 <= now - row.get("timestamp", -math.inf) <= 3):
                raise CurveError("seed_unavailable")
            seed = (feedback, now, epoch)
        if not math.isfinite(seed[0]) or not 0 <= seed[0] <= 100:
            raise CurveError("seed_unavailable")
        return seed

    async def _curve_loop(self, runner: PidRunner, ticket: HeaterTicket) -> None:
        deadline = self._clock() + 1
        while self.current(ticket) and runner.state_name in ("running", "holding"):
            await asyncio.sleep(max(0, deadline - self._clock()))
            if not self.current(ticket):
                return
            try:
                await runner.tick()
            except Exception:
                _log.exception("Curve PID tick failed")
                if self.owns(ticket):
                    await self._end_curve("write_fault")
            deadline += max(1, math.floor(self._clock() - deadline) + 1)

    def _parse_authority(self, value: Any) -> dict[str, Any]:
        body = _object(value, {"session_id", "charge_id", "run_id", "sensor_clock", "connection_epoch", "generation"}, "authority")
        for key in ("session_id", "charge_id", "run_id"):
            _identifier(body[key])
        parse_clock(body["sensor_clock"])
        _integer(body["connection_epoch"])
        _integer(body["generation"])
        return body

    def renew(self, value: Any) -> dict[str, Any]:
        authority = self._parse_authority(value)
        if not self.is_curve() or authority != self._operation.mode.authority or not self.current(self._operation.ticket) or self._operation.phase not in ("starting", "active"):
            raise CurveError("stale_authority")
        now = self._clock()
        curve = replace(self._operation.mode, lease_deadline=now + VIRTUAL_CONFIG.lease_sec)
        self._operation = replace(self._operation, mode=curve)
        self._schedule_lease()
        return {"ok": True, "authority": deepcopy(authority), "server_time": now, "lease_deadline": curve.lease_deadline}

    def _schedule_lease(self) -> None:
        if self._lease_handle is not None:
            self._lease_handle.cancel()
        operation = self._operation
        assert operation is not None and isinstance(operation.mode, CurveOperation)
        assert self._charge is not None
        target_deadline = self._charge["acquired_at"] + operation.mode.target.end_sec
        def expired() -> None:
            if (self.is_curve() and self._operation.mode.run_id == operation.mode.run_id
                    and self._operation.phase in ("starting", "active")):
                lease_deadline = self._operation.mode.lease_deadline
                if self._clock() >= min(lease_deadline, target_deadline):
                    self._begin_curve_end("reference_exhausted" if target_deadline <= lease_deadline else "lease_expired")
                else:
                    self._schedule_lease()
        self._lease_handle = asyncio.get_running_loop().call_later(
            max(0, min(operation.mode.lease_deadline, target_deadline) - self._clock()), expired)

    def _begin_curve_end(self, reason: str) -> asyncio.Task[Any]:
        operation = self._operation
        assert operation is not None and isinstance(operation.mode, CurveOperation)
        if reason in ("drop", "reset", "disconnected", "workspace_changed"):
            self.close_charge(reason)
        if (operation.phase == "stopping" and self._terminal_task is not None
                and self._terminal_task[0] == operation.ticket and not self._terminal_task[1].done()):
            return self._terminal_task[1]
        if self._lease_handle is not None:
            self._lease_handle.cancel()
        ticket = self.revoke("safety")
        operation.runner.invalidate()
        operation = replace(operation, ticket=ticket, phase="stopping",
                            mode=replace(operation.mode, reason=operation.mode.reason or reason, terminal_outcome="pending"))
        self._operation = operation
        task = asyncio.create_task(self._finish_curve(operation))
        self._terminal_tasks.add(task)
        self._terminal_task = (ticket, task)
        def completed(done: asyncio.Task[Any]) -> None:
            self._terminal_tasks.discard(done)
            if not done.cancelled():
                done.exception()
        task.add_done_callback(completed)
        return task

    async def _end_curve(self, reason: str) -> None:
        if not self.is_curve():
            return
        await asyncio.shield(self._begin_curve_end(reason))

    async def _finish_curve(self, operation: PidOperation) -> None:
        try:
            await self.drain()
            self._check(operation.ticket)
            await self._write({"heater": operation.mode.config.out_min}, operation.ticket)
            self._check(operation.ticket)
            self._complete_curve(operation)
            self.revoke()
        except (Exception, asyncio.CancelledError):
            if self.owns(operation.ticket) and self.is_curve():
                operation.runner.invalidate("Curve terminal write unresolved")
                self._operation = replace(self._operation, phase="fault",
                                          mode=replace(self._operation.mode, terminal_outcome="uncertain" if self._uncertain else "failed"))
            raise

    def _complete_curve(self, operation: PidOperation) -> None:
        snapshot = self.curve_snapshot()
        assert snapshot is not None
        snapshot.update(phase="terminal", runner_state="off", terminal_outcome="completed", lease_deadline=None)
        self._runs[operation.mode.run_id] = deepcopy(snapshot)
        self._last_curve = snapshot
        self._operation = None

    async def stop_curve(self, value: Any) -> dict[str, Any]:
        body = _object(value, {"mode", "authority", "reason"})
        if body["mode"] != "curve" or body["reason"] not in ("user", "drop", "view_hidden", "workspace_changed"):
            raise CurveError("invalid_request", status=400)
        authority = self._parse_authority(body["authority"])
        known = self._runs.get(authority["run_id"])
        if known is not None and known["authority"] == authority:
            return self._curve_reply(deepcopy(known))
        if not self.is_curve() or self._operation.mode.authority != authority:
            raise CurveError("stale_authority")
        await self._end_curve(body["reason"])
        return self._curve_reply()

    def _attempt(self, values: dict[str, float], ticket: HeaterTicket | None) -> dict[str, Any] | None:
        if "heater" not in values or self._charge is None or ticket is None:
            return None
        self._check(ticket)
        charge = self._charge
        operation = self._operation
        curve = operation.mode if operation is not None and isinstance(operation.mode, CurveOperation) else None
        filtered = self._filtered
        now = self._clock()
        elapsed = now - charge["acquired_at"]
        target = curve.target.at(elapsed) if curve and curve.target.points[0].elapsed_sec <= elapsed < curve.target.end_sec else None
        purpose = "terminal" if ticket.origin == "safety" else ("regulate" if ticket.origin == "pid" else ticket.origin)
        entry = {"session_id": charge["session_id"], "charge_id": charge["charge_id"], "sequence": 0,
                 "attempt_sequence": 0, "run_id": curve.run_id if curve else None,
                 "generation": ticket.generation, "connection_epoch": ticket.connection_epoch,
                 "sensor_clock": charge["sensor_clock"], "origin": ticket.origin, "purpose": purpose,
                 "event": "attempt", "observed_at": now, "elapsed_sec": elapsed,
                 "sample": {"sensor_clock": filtered.sample.clock, "acquired_at": filtered.sample.acquired_at} if filtered else None,
                 "raw_bt_c": filtered.sample.bt_c if filtered else None, "control_pv_c": filtered.value if filtered else None,
                 "target_bt_c": target,
                 "requested_heat_set": operation.runner.requested_output if curve and purpose == "regulate" and operation.runner.requested_output is not None else values["heater"],
                 "permitted_heat_set": values["heater"], "acknowledged_heat_set": None, "evidence": "none",
                 "outcome": "pending", "reconciles_sequence": None, "reason": None}
        return self._append_receipt(entry)

    def _append_receipt(self, attempt: dict[str, Any], **changes: Any) -> dict[str, Any]:
        journal = self._journals[attempt["charge_id"]]
        sequence = journal["next"]
        entry = {**attempt, **changes, "sequence": sequence,
                 "attempt_sequence": attempt["attempt_sequence"] or sequence,
                 "observed_at": self._clock()}
        # Observation time can outlive Drop; its original immutable command context stays intact.
        if self._charge and self._charge["charge_id"] == attempt["charge_id"]:
            entry["elapsed_sec"] = self._clock() - self._charge["acquired_at"]
        journal["entries"].append(entry)
        journal["next"] += 1
        return entry

    def receipts(self, charge_id: str, after: int = 0, limit: int = 256) -> dict[str, Any]:
        _identifier(charge_id)
        _integer(after)
        _integer(limit)
        if not 1 <= limit <= 512:
            raise CurveError("invalid_request", status=400)
        journal = self._journals.get(charge_id)
        if journal is None:
            raise CurveError("journal_unavailable", status=410)
        if after >= journal["next"]:
            raise CurveError("invalid_request", "Future receipt cursor", status=400)
        entries = journal["entries"]
        first = entries[0]["sequence"] if entries else journal["next"]
        page = [deepcopy(row) for row in entries if row["sequence"] > after][:limit]
        next_after = page[-1]["sequence"] if page else after
        return {"session_id": journal["session_id"], "charge_id": charge_id, "first_available": first,
                "next_sequence": journal["next"], "next_after": next_after,
                "has_more": next_after < journal["next"] - 1,
                "gap": {"from": after + 1, "through": first - 1} if after + 1 < first else None,
                "receipts": page}

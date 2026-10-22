"""Heater authority and completion barriers for a single connection."""

import asyncio
from dataclasses import dataclass, asdict
import logging
from typing import Any, Awaitable, Callable, Literal

import config
from control_guard import ControlUnavailable, clamp_command
from pid import PidGains
from pid_runner import PidRunner, PvSample, STOP_HOLD

_log = logging.getLogger(__name__)
Origin = Literal["manual", "replay", "pid", "safety"]


@dataclass(frozen=True)
class HeaterTicket:
    connection_epoch: int
    generation: int
    origin: Origin


@dataclass(frozen=True)
class PidOperation:
    ticket: HeaterTicket
    runner: PidRunner
    phase: Literal["starting", "active", "stopping", "fault"]


class ControlUncertain(TimeoutError):
    """A submitted writer has not completed; its physical outcome is unknown."""


class HeaterControlSession:
    def __init__(self, *, epoch: Callable[[], int], adapter: Callable[[], Any],
                 available: Callable[[], bool], read_pv: Callable[[], Awaitable[PvSample]],
                 read_feedback: Callable[[], Awaitable[float | None]],
                 applied: Callable[[dict[str, float]], None],
                 limits: Callable[[], dict[str, dict[str, Any]]]) -> None:
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
        self.revoke()
        await self.drain()
        self._operation = None
        self.runner = None

    async def _write(self, values: dict[str, float], ticket: HeaterTicket | None,
                     *, retry: bool = False, command: int | None = None) -> dict[str, float]:
        values = clamp_command(values, self._limits())
        adapter, epoch = self._adapter(), self._epoch()

        def is_current() -> bool:
            return (self._available() and self._adapter() is adapter and self._epoch() == epoch
                    and (ticket is None or self.current(ticket))
                    and (command is None or self._command == command))

        async def write() -> None:
            if not is_current():
                raise ControlUnavailable("Control ownership changed before write.")
            await adapter.control(**values, _is_current=is_current, _confirm_first=retry)
            if is_current():
                self._applied(values)

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
            raise ControlUncertain("Submitted control write has an uncertain outcome.") from exc
        if not is_current():
            raise ControlUnavailable("Control ownership changed during write.")
        return values

    async def claim_replay(self, epoch: int, generation: int) -> HeaterTicket:
        if (epoch != self._epoch() or generation != self.ticket.generation
                or self.ticket.origin not in ("manual", "replay") or self._uncertain):
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
            ticket = self.revoke()
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
        return await self._write(values, ticket, retry=retry_epoch is not None, command=self._command)

    async def start_fixed(self, sv: float, gains: PidGains) -> dict[str, Any]:
        if self._uncertain:
            raise ControlUncertain("Previous heater write remains uncertain.")
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

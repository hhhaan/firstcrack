"""Per-operation facts carried across executor boundaries without additional PLC I/O."""
import asyncio
import time
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

_ERROR_CODES = (
    ("timeout", ("timeout", "timed out")),
    ("connection_reset", ("connection reset", "reset by peer")),
    ("connection_refused", ("connection refused",)),
    ("address_range", ("address out of range", "address range")),
    ("function_refused", ("function refused", "function not available")),
    ("receive_failure", ("recv", "receive")),
    ("send_failure", ("send",)),
)


class S7Diagnostics:
    def __init__(self, operation: str) -> None:
        try:
            self._started = time.monotonic()
        except Exception:
            self._started = 0.0
        self._facts: dict[str, Any] = {
            "operation": operation, "status": "active", "stage": "queued",
            "steps": [], "completed_writes": 0, "final_zero_reached": None,
        }

    def update(self, **facts: Any) -> None:
        try:
            self._facts = {**self._facts, **facts}
        except Exception:
            pass

    def snapshot(self) -> dict[str, Any]:
        try:
            return {**self._facts, "elapsed_ms": round((time.monotonic() - self._started) * 1000, 1)}
        except Exception:
            return {}

    def attach(self, exc: BaseException, **facts: Any) -> None:
        try:
            exc.s7_diagnostics = {**self.snapshot(), **facts}
        except Exception:
            pass

    def call(self, stage: str, action: Callable[..., T], *args: Any,
             details: dict[str, Any] | None = None, **kwargs: Any) -> T:
        started = None
        try:
            started = time.monotonic()
            self.update(stage=stage, active_step={"stage": stage, **(details or {})})
        except Exception:
            pass
        error: BaseException | None = None
        not_acquired = False
        try:
            result = action(*args, **kwargs)
            not_acquired = stage == "lock" and result is False
            return result
        except BaseException as exc:
            error = exc
            raise
        finally:
            try:
                step = {
                    "stage": stage, **(details or {}),
                    "elapsed_ms": round((time.monotonic() - started) * 1000, 1) if started is not None else None,
                    "outcome": "failed" if error is not None else "not_acquired" if not_acquired else "returned",
                }
                if error is not None:
                    error_code = "unknown"
                    try:
                        message = str(error).lower()
                        error_code = next(
                            (code for code, terms in _ERROR_CODES if any(term in message for term in terms)),
                            "unknown",
                        )
                    except Exception:
                        pass
                    step.update(error_type=type(error).__name__, error_code=error_code)
                if (error is not None or not_acquired) and "first_failure" not in self._facts:
                    self.update(first_failure=step)
                self.update(steps=[*self._facts["steps"], step][-16:], active_step=None)
            except Exception:
                pass

    def execute(self, action: Callable[[], T]) -> T:
        try:
            result = action()
        except BaseException as exc:
            self.update(status="failed")
            self.attach(exc)
            raise
        self.update(status="completed")
        return result

    async def run(self, action: Callable[[], T]) -> T:
        try:
            return await asyncio.get_running_loop().run_in_executor(None, self.execute, action)
        except BaseException as exc:
            # asyncio may replace executor TimeoutError; cancellation also needs an active snapshot.
            self.attach(exc, **({"await_cancelled": True} if isinstance(exc, asyncio.CancelledError) else {}))
            raise

    def wrote(self, *, final_zero: bool = False) -> None:
        try:
            self.update(completed_writes=self._facts["completed_writes"] + 1)
            if final_zero:
                self.update(final_zero_reached=True)
        except Exception:
            pass

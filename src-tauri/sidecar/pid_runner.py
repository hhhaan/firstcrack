"""PID 제어 루프의 수명과 안전 상태.

계산은 pid.SoftwarePid가, I/O는 주입된 콜러블이 담당한다. 이 모듈은 "언제
쓰고, 언제 멈추고, 언제 불을 끄는가"만 결정한다. manager/adapter/소켓 없이
가상 시계로 tick()을 돌려 검증할 수 있게 의존성을 전부 주입받는다.

상태 전이:

    OFF ──start(sv)──▶ RUNNING ◀──PV 복구──▶ HOLDING
     ▲                   │                      │
     │                   │ 쓰기 3연속 실패        │ 5초 초과
     │                   │ BT > 260°C           │
     │                   │ 연결 끊김             │
     │                   ▼                      ▼
     └──start/stop로 해제── FAULT ◀─────────────┘

FAULT 진입 시 연결이 살아 있으면 heater 0을 시도한다. 해제는 사용자가
명시적으로 다시 켜거나 끌 때만 — 원인을 모른 채 자동 복귀하지 않는다.
"""

import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import config
from pid import PidGains, SoftwarePid

_log = logging.getLogger(__name__)

# 상태
OFF = "off"
RUNNING = "running"
HOLDING = "holding"
FAULT = "fault"

# stop() 모드 — DROP 시 화력을 어떻게 둘지
STOP_HOLD = "hold"   # 현재 피드백 duty를 세트포인트에 써서 유지 (연속 배치용)
STOP_ZERO = "zero"   # heater 0


@dataclass
class PvSample:
    """제어에 쓰는 온도 표본."""
    bt: float | None
    ts: float
    stale: bool
    connected: bool


class PidRunner:
    def __init__(
        self,
        *,
        read_pv: Callable[[], Awaitable[PvSample]],
        write_duty: Callable[[float], Awaitable[None]],
        read_feedback: Callable[[], Awaitable[float | None]] | None = None,
        gains: PidGains,
        clock: Callable[[], float] = time.monotonic,
        duty_deadband: float = config.PID_DUTY_DEADBAND,
        resend_every_n_ticks: int = config.PID_RESEND_EVERY_N_TICKS,
    ) -> None:
        self._read_pv = read_pv
        self._write_duty = write_duty
        self._read_feedback = read_feedback
        self._clock = clock
        self._duty_deadband = duty_deadband
        self._resend_every = resend_every_n_ticks

        self._pid = SoftwarePid(gains)
        self._state = OFF
        self._error: str | None = None
        self._last_sent: float | None = None
        self._ticks_since_send = 0
        self._write_failures = 0
        self._hold_since: float | None = None
        self._last_duty: float | None = None
        self._last_pv: float | None = None

    # ── 조회 ───────────────────────────────────────────────────────────────

    @property
    def state_name(self) -> str:
        return self._state

    def state(self) -> dict[str, Any]:
        snap = self._pid.snapshot()
        return {
            "state": self._state,
            "sv": snap["sv"] if self._state != OFF else None,
            "duty": round(self._last_duty, 1) if self._last_duty is not None else None,
            "pv": round(self._last_pv, 1) if self._last_pv is not None else None,
            "p": snap["p"],
            "i": snap["i"],
            "d": snap["d"],
            "error": self._error,
        }

    # ── 수명 주기 ──────────────────────────────────────────────────────────

    async def start(self, sv: float) -> None:
        """제어 시작. 현재 머신 duty를 읽어 그 값에서 이어받는다(bumpless).

        FAULT였더라도 사용자가 명시적으로 다시 켜는 것이므로 상태를 초기화한다.
        """
        now = self._clock()
        seed = None
        if self._read_feedback is not None:
            try:
                seed = await self._read_feedback()
            except Exception as exc:  # 피드백 실패는 치명적이지 않다 — 0에서 시작
                _log.warning("PID engage: heater 피드백 읽기 실패 — %s", exc)

        self._pid.reset()
        self._pid.set_target(sv)
        self._pid.engage(now, seed_output=seed)
        self._state = RUNNING
        self._error = None
        self._last_sent = None
        self._ticks_since_send = 0
        self._write_failures = 0
        self._hold_since = None
        _log.info("PID 시작: SV=%.1f°C seed=%s", sv, seed)

    async def stop(self, reason: str = "user", *, mode: str = STOP_HOLD) -> None:
        """제어 중단.

        mode=hold: 머신이 보고하는 현재 duty를 세트포인트에 되써서 화력을 유지한다.
          Artisan이 PID를 끌 때 하는 동작과 같다. 연속 배치에서 재승온 시간을 아낀다.
        mode=zero: heater 0.
        """
        if self._state == OFF:
            return
        self._pid.release()
        self._state = OFF
        self._error = None
        self._hold_since = None
        try:
            if mode == STOP_ZERO:
                await self._write_duty(0.0)
                self._last_duty = 0.0
            elif self._read_feedback is not None:
                feedback = await self._read_feedback()
                if feedback is not None:
                    await self._write_duty(feedback)
                    self._last_duty = feedback
        except Exception as exc:
            # 끄는 데 실패해도 상태는 OFF로 둔다 — 루프가 계속 쓰는 것보다 안전하다
            _log.error("PID stop(%s) 마무리 쓰기 실패: %s", mode, exc)
        _log.info("PID 중단: reason=%s mode=%s", reason, mode)

    async def set_sv(self, sv: float) -> None:
        if self._state not in (RUNNING, HOLDING):
            raise RuntimeError("PID가 실행 중이 아닙니다.")
        self._pid.set_target(sv)

    # ── 한 사이클 ──────────────────────────────────────────────────────────

    async def tick(self) -> None:
        """제어 한 주기. OFF/FAULT에서는 아무것도 하지 않는다."""
        if self._state not in (RUNNING, HOLDING):
            return

        now = self._clock()
        try:
            pv = await self._read_pv()
        except Exception as exc:
            await self._fault(f"PV 읽기 실패: {exc}", attempt_safe_off=True)
            return

        if not pv.connected:
            # 연결이 없으면 쓸 수 있는 경로도 없다 — 시도하지 않는다
            await self._fault("머신 연결이 끊겼습니다.", attempt_safe_off=False)
            return

        if pv.bt is None or pv.stale or (now - pv.ts) > config.PID_PV_MAX_AGE_S:
            await self._enter_or_continue_hold(now)
            return

        self._last_pv = pv.bt
        if pv.bt > config.SAFETY_MAX_BT_C:
            await self._fault(
                f"BT가 안전 상한({config.SAFETY_MAX_BT_C:.0f}°C)을 넘었습니다.",
                attempt_safe_off=True,
            )
            return

        if self._state == HOLDING:
            # 공백 구간을 적분에 반영하지 않도록 시간 기준을 다시 잡는다
            self._pid.resume(now)
            self._state = RUNNING
            self._hold_since = None

        duty = self._pid.update(pv.bt, now)
        if duty is None:
            return
        self._last_duty = duty
        await self._emit(duty)

    # ── 내부 ───────────────────────────────────────────────────────────────

    async def _enter_or_continue_hold(self, now: float) -> None:
        """PV를 믿을 수 없는 구간 — 쓰기를 멈추고 머신이 마지막 duty를 유지하게 둔다."""
        if self._state == RUNNING:
            self._state = HOLDING
            self._hold_since = now
            _log.warning("PID HOLD 진입 — PV 신뢰 불가")
            return
        if self._hold_since is not None and (now - self._hold_since) > config.PID_HOLD_TIMEOUT_S:
            await self._fault("온도 읽기가 계속 실패해 제어를 중단했습니다.", attempt_safe_off=True)

    async def _emit(self, duty: float) -> None:
        """deadband/주기 조건을 만족할 때만 실제로 쓴다."""
        should_send = (
            self._last_sent is None
            or abs(duty - self._last_sent) >= self._duty_deadband
            or self._ticks_since_send >= self._resend_every
        )
        if not should_send:
            self._ticks_since_send += 1
            return
        try:
            await self._write_duty(duty)
        except Exception as exc:
            self._write_failures += 1
            _log.warning(
                "PID duty 쓰기 실패 (%d/%d): %s",
                self._write_failures, config.PID_WRITE_FAIL_LIMIT, exc,
            )
            if self._write_failures >= config.PID_WRITE_FAIL_LIMIT:
                await self._fault("머신에 제어값을 쓰지 못했습니다.", attempt_safe_off=True)
            return
        self._write_failures = 0
        self._last_sent = duty
        self._ticks_since_send = 0

    async def _fault(self, message: str, *, attempt_safe_off: bool) -> None:
        self._pid.release()
        self._state = FAULT
        self._error = message
        self._hold_since = None
        _log.error("PID FAULT: %s", message)
        if not attempt_safe_off:
            return
        for attempt in range(config.PID_SAFE_OFF_RETRIES):
            try:
                await self._write_duty(0.0)
                self._last_duty = 0.0
                return
            except Exception as exc:
                _log.error(
                    "PID 안전 정지 쓰기 실패 (%d/%d): %s",
                    attempt + 1, config.PID_SAFE_OFF_RETRIES, exc,
                )

"""
가상 로스팅 머신 시뮬레이터 — 개발/테스트용.

세 단계로 동작한다:
  1. 예열/대기: 목표 온도에서 시작해 제어값에 따라 변한다.
  2. Charge: 현재 BT/ET에서 연속으로 로스팅 곡선에 진입한다.
  3. 로스팅: 화력/배기의 변화가 ET에 먼저, BT에 늦게 반영된다.
"""

import dataclasses
import math
import time
import logging
from bisect import bisect_right
from collections.abc import Callable
from typing import Any

from adapters.base import Reading
from adapters.thermal_model import FirstOrderThermalModel

_log = logging.getLogger(__name__)


# ── 선형 보간 ──────────────────────────────────────────────


def _interp(x: float, xp: list[float], fp: list[float]) -> float:
    if x <= xp[0]:
        return fp[0]
    if x >= xp[-1]:
        return fp[-1]
    i = bisect_right(xp, x)
    x0, x1 = xp[i - 1], xp[i]
    y0, y1 = fp[i - 1], fp[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


# ── 예열 시뮬레이션 파라미터 ───────────────────────────────

_PREHEAT_TARGET_BT = 210.0 # 예열 목표 BT (connect 즉시 도달)
_PREHEAT_TARGET_ET = 230.0 # 예열 목표 ET (connect 즉시 도달)

# ponytail: 기준 곡선 + 2단 열 지연 모델. 실기 로그가 생기면 게인/시정수를 보정한다.
_AMBIENT = 25.0
_HEATER_GAIN = 1.5  # 기준 화력 초과 1%당 ET 평형 변화(°C)
_FAN_GAIN = 0.3  # 배기 1% 변화당 ET 평형 변화(°C)
_ET_TAU = 50.0  # ET 응답 시간(초)
_BT_TAU = 110.0  # BT 응답 시간(초)
_BT_GAIN = 0.75  # ET 변화 중 BT에 전달되는 비율


# ── 로스팅 프로파일 ────────────────────────────────────────
#
# t=0 = Charge (생두 투입) 시점. 기준 온도 200°C.
# 처음 15초에 25°C 즉각 강하 → 90초에 TP → 이후 로스팅 상승.

def _build_roast_profile() -> dict[str, Any]:
    """0~780초(13분) 로스팅 프로파일. 기준 BT 200°C (실제 charge BT와의 차이는 오프셋 적용)."""
    times: list[float] = []
    bts: list[float] = []
    ets: list[float] = []

    for t in range(0, 781, 5):
        # BT: 실제 로스팅 머신과 유사한 곡선
        #   0~20s  : charge 충격으로 급강하 (22°C/20s)
        #   20~120s: 완만하게 TP(145°C)로 하강
        #   120~180s: TP 이후 완만 회복 (건조 시작)
        #   180~360s: Maillard — 온도 상승 가속
        #   360~540s: 1C 접근
        #   540~660s: 1C ~ Development
        #   660~780s: Drop 직전 마무리
        if t <= 20:
            bt = 200.0 - (22.0 * t) / 20.0
        elif t <= 120:
            bt = 178.0 - (33.0 * (t - 20)) / 100.0
        elif t <= 180:
            bt = 145.0 + (7.0 * (t - 120)) / 60.0
        elif t <= 360:
            bt = 152.0 + (22.0 * (t - 180)) / 180.0
        elif t <= 540:
            bt = 174.0 + (19.0 * (t - 360)) / 180.0
        elif t <= 660:
            bt = 193.0 + (7.0 * (t - 540)) / 120.0
        else:
            bt = 200.0 + (8.0 * (t - 660)) / 120.0

        # ET: 드럼 환경 온도 — 항상 BT보다 높고 완만하게 상승
        #   0~30s  : 생두 투입 충격으로 소폭 강하
        #   30~90s : 회복
        #   90~420s: 완만한 상승 (Maillard 진행)
        #   420~780s: 지속 상승
        if t <= 30:
            et = 230.0 - (12.0 * t) / 30.0
        elif t <= 90:
            et = 218.0 + (6.0 * (t - 30)) / 60.0
        elif t <= 420:
            et = 224.0 + (10.0 * (t - 90)) / 330.0
        else:
            et = 234.0 + (8.0 * (t - 420)) / 360.0

        times.append(float(t))
        bts.append(round(bt, 2))
        ets.append(round(et, 2))

    return {"timex": times, "bt": bts, "et": ets}


_ROAST_PROFILE = _build_roast_profile()


# ── 어댑터 ─────────────────────────────────────────────────


class VirtualMachineAdapter:
    """개발/테스트용 가상 머신 어댑터.

    connect() → 예열 목표에서 시작
    enter_standby() → auto-charge 검사용 투입 신호
    start_roast() → 현재 온도에서 연속으로 로스팅 곡선 시작
    """

    def __init__(
        self,
        mode: str = "C",
        write_map: dict[str, dict[str, Any]] | None = None,
        sim: str = "scripted",
        clock: Callable[[], float] | None = None,
        **_: Any,
    ) -> None:
        self._connected: bool = False
        self._roasting: bool = False
        self._connect_time: float = 0.0
        self._roast_start_time: float = 0.0
        self._charge_bt: float = _PREHEAT_TARGET_BT  # Charge 시점 BT
        self._charge_et: float = _PREHEAT_TARGET_ET
        self._standby_time: float = 0.0  # enter_standby() 호출 시각
        self._et_offset = 0.0
        self._bt_offset = 0.0
        self._sim_ts = 0.0
        self._write_map = write_map or {}
        # control()로 받은 명령값. None이면 스크립트 기본값을 그대로 재생한다.
        self._cmd: dict[str, float] = {}
        # sim="thermal": duty에 반응하는 1차 지연 모델로 BT를 만든다 (PID 검증용).
        # 기본 "scripted"는 로스팅 기준 곡선에 열 지연 응답을 더한다.
        self._sim = sim
        self._clock = clock or time.monotonic
        self._model = FirstOrderThermalModel() if sim == "thermal" else None
        self._model_ts: float | None = None

    async def connect(self) -> None:
        self._connect_time = self._clock()
        self._roasting = False
        self._standby_time = 0.0
        self._charge_bt = _PREHEAT_TARGET_BT
        self._charge_et = _PREHEAT_TARGET_ET
        self._et_offset = 0.0
        self._bt_offset = 0.0
        self._sim_ts = self._connect_time
        self._connected = True
        # 모델 시각 기준을 여기서 잡는다. 첫 read에서야 잡으면 그 사이 흐른 시간이
        # 통째로 버려져 "duty를 올렸는데 온도가 그대로"인 것처럼 보인다.
        if self._model is not None:
            self._model_ts = self._clock()
        _log.info("VirtualMachine connected — preheating")

    async def disconnect(self) -> None:
        self._connected = False
        self._roasting = False

    async def read(self) -> Reading:
        if not self._connected:
            return Reading(bt=-1.0, et=-1.0, heater=None, fan=0, drum=0, timestamp=self._clock())

        if self._model is not None:
            return self._read_thermal()
        reading = self._read_preheat() if not self._roasting else self._read_roasting()
        return self._apply_cmd(reading)

    def _advance_scripted(self, now: float) -> None:
        dt = max(0.0, now - self._sim_ts)
        start = self._sim_ts
        self._sim_ts = now
        if not dt:
            return
        steps = math.ceil(dt / 5.0)
        step = dt / steps
        heater = self._cmd.get("heater", 60.0)
        cooling = max(0.0, 1.0 - heater / 60.0)
        for i in range(steps):
            elapsed = max(0.0, start + (i + 1) * step - self._roast_start_time)
            if self._roasting:
                base_bt = (
                    _interp(elapsed, _ROAST_PROFILE["timex"], _ROAST_PROFILE["bt"])
                    + self._charge_bt - _ROAST_PROFILE["bt"][0]
                )
                base_et = (
                    _interp(elapsed, _ROAST_PROFILE["timex"], _ROAST_PROFILE["et"])
                    + self._charge_et - _ROAST_PROFILE["et"][0]
                )
                default_fan = min(70.0, 30.0 + elapsed * 40.0 / 780.0)
            else:
                base_bt, base_et, default_fan = _PREHEAT_TARGET_BT, _PREHEAT_TARGET_ET, 20.0
            if cooling:
                et_target = (_AMBIENT - base_et) * cooling
            else:
                et_target = (heater - 60.0) * _HEATER_GAIN
            et_target -= (self._cmd.get("fan", default_fan) - default_fan) * _FAN_GAIN
            et_target = max(_AMBIENT - base_et, et_target)
            self._et_offset += (et_target - self._et_offset) * (1.0 - math.exp(-step / _ET_TAU))
            bt_target = self._et_offset * _BT_GAIN * (1.0 - cooling) + (_AMBIENT - base_bt) * cooling
            self._bt_offset += (bt_target - self._bt_offset) * (1.0 - math.exp(-step / _BT_TAU))

    def _read_thermal(self) -> Reading:
        """duty에 반응하는 모델 기반 판독 — PID 루프 검증용."""
        assert self._model is not None
        now = self._clock()
        dt = 0.0 if self._model_ts is None else max(0.0, now - self._model_ts)
        self._model_ts = now
        duty = self._cmd.get("heater", 0.0)
        bt = self._model.step(duty, dt)
        return Reading(
            bt=round(bt, 1),
            et=round(bt + 15.0, 1),
            heater=round(duty, 1),
            fan=round(self._cmd.get("fan", 0.0), 1),
            drum=round(self._cmd.get("drum", 0.0), 1),
            timestamp=now,
        )

    def _read_preheat(self) -> Reading:
        """예열 + 대기 단계: standby 진입 10초 후 BT를 5°C/s로 최대 25°C 강하 → auto-charge 유발."""
        now = self._clock()
        self._advance_scripted(now)
        bt_base = _PREHEAT_TARGET_BT
        if self._standby_time > 0:
            elapsed = now - self._standby_time - 10.0
            if elapsed > 0:
                bt_base -= min(elapsed * 5.0, 25.0)

        bt = bt_base + self._bt_offset
        et = _PREHEAT_TARGET_ET + self._et_offset

        heater = 60.0
        fan = 20.0
        drum = 50.0

        return Reading(
            bt=round(bt, 1),
            et=round(et, 1),
            heater=round(heater, 1),
            fan=fan,
            drum=drum,
            timestamp=now,
        )

    async def enter_standby(self) -> None:
        """READY 버튼 → 10초 후 BT 강하 시작, auto-charge 감지 유발."""
        self._standby_time = self._clock()
        _log.info("VirtualMachine: standby entered — bean drop in 10s")

    def _read_roasting(self) -> Reading:
        """로스팅 단계: Charge BT 기준 오프셋 적용 후 프로파일 보간."""
        now = self._clock()
        self._advance_scripted(now)
        tx = now - self._roast_start_time

        bt_profile = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["bt"])
        et_profile = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["et"])

        bt = bt_profile + self._charge_bt - _ROAST_PROFILE["bt"][0] + self._bt_offset
        et = et_profile + self._charge_et - _ROAST_PROFILE["et"][0] + self._et_offset

        # 화력은 스크립트가 건드리지 않는다 — 실기처럼 control() 명령으로만 변한다.
        # (자동 스텝다운 스크립트는 배치당 30+회의 가짜 조정 이벤트를 기록에 남겨 삭제)
        heater = 60.0
        fan = min(70.0, 30.0 + (tx / 780.0) * 40.0)
        drum = 50.0

        return Reading(
            bt=round(bt, 1),
            et=round(et, 1),
            heater=round(heater, 1),
            fan=round(fan, 1),
            drum=drum,
            timestamp=now,
        )

    async def start_roast(self) -> None:
        """Charge 시점. 현재 BT를 기록하고 로스팅 커브 재생 시작."""
        # Charge 직전 예열 온도를 캡처해 로스팅 프로파일 오프셋에 사용
        preheat = self._read_preheat()
        self._charge_bt = preheat.bt - self._bt_offset
        self._charge_et = preheat.et - self._et_offset
        self._roast_start_time = self._clock()
        self._roasting = True
        _log.info("VirtualMachine: charge at BT=%.1f°C — roasting started", self._charge_bt)

    async def reset_roast(self) -> None:
        """배치 상태를 지우되 센서 연결과 실제 온도는 유지한다."""
        if self._model is not None:
            return
        reading = self._read_roasting() if self._roasting else self._read_preheat()
        self._roasting = False
        self._standby_time = 0.0
        self._bt_offset = reading.bt - _PREHEAT_TARGET_BT
        self._et_offset = reading.et - _PREHEAT_TARGET_ET

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        """명령을 저장하고 이전 명령의 열 응답을 현재 시각까지 진행한다."""
        if self._connected and self._model is None:
            self._advance_scripted(self._clock())
        for role, value in (("heater", heater), ("fan", fan), ("drum", drum)):
            if value is not None:
                self._cmd[role] = float(value)

    def _apply_cmd(self, reading: Reading) -> Reading:
        """control()로 받은 값이 있으면 스크립트 값 대신 그것을 표시한다."""
        if not self._cmd:
            return reading
        return dataclasses.replace(
            reading,
            heater=self._cmd.get("heater", reading.heater),
            fan=self._cmd.get("fan", reading.fan),
            drum=self._cmd.get("drum", reading.drum),
        )

    @property
    def write_map(self) -> dict[str, dict[str, Any]]:
        return self._write_map

    @property
    def connected(self) -> bool:
        return self._connected

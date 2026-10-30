"""
가상 로스팅 머신 시뮬레이터 — 개발/테스트용.

세 단계로 동작한다:
  1. 연결 직후: 실측 BBP를 재생한다
  2. BBP가 끝나면 Charge 하락이 이어지고, 그 하락으로 자동 Charge가 걸린다
  3. Charge 이후: 같은 실측의 Charge→Drop을 이어서 재생한다
"""

import dataclasses
import math
import random
import time
import logging
from bisect import bisect_right
from typing import Any

from adapters.base import Reading
from adapters.recorded_curve import RECORDED_BBP, RECORDED_CURVE

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


def _load_recorded_profile(text: str) -> dict[str, list[float]]:
    """절대온도 곡선. 시각은 단조 증가여야 보간이 된다."""
    times: list[float] = []
    bts: list[float] = []
    ets: list[float] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("time") or line.startswith("#"):
            continue
        t_s, bt_s, et_s = line.split("\t")
        t = float(t_s)
        if t < 0 or (times and t <= times[-1]):
            continue
        times.append(t)
        bts.append(float(bt_s))
        ets.append(float(et_s))
    if len(times) < 2:
        raise RuntimeError("recorded roast curve is empty")
    return {"timex": times, "bt": bts, "et": ets}


def _sample(profile: dict[str, list[float]], tx: float) -> tuple[float, float]:
    return (
        _interp(tx, profile["timex"], profile["bt"]),
        _interp(tx, profile["timex"], profile["et"]),
    )


_BBP_PROFILE = _load_recorded_profile(RECORDED_BBP)
_ROAST_PROFILE = _load_recorded_profile(RECORDED_CURVE)
_BBP_END = _BBP_PROFILE["timex"][-1]


# ── 노이즈 ────────────────────────────────────────────────


def _noise(scale: float = 0.3) -> float:
    """±scale °C 범위의 부드러운 노이즈."""
    return (random.random() * 2 - 1) * scale


# ── 어댑터 ─────────────────────────────────────────────────


class VirtualMachineAdapter:
    """개발/테스트용 가상 머신 어댑터.

    connect() → 실측 BBP 재생
    start_roast() → 이미 시작된 Charge 하락을 끊지 않고 로스팅 곡선을 잇는다
    """

    def __init__(
        self,
        mode: str = "C",
        write_map: dict[str, dict[str, Any]] | None = None,
        **_: Any,
    ) -> None:
        self._connected: bool = False
        self._roasting: bool = False
        self._connect_time: float = 0.0
        self._roast_start_time: float = 0.0
        self._write_map = write_map or {}
        # control()로 받은 명령값. 온도 곡선은 실측 재생이라 이 값으로 바뀌지 않는다.
        self._cmd: dict[str, float] = {}
        # W60A door-probe stand-in. DB2.30 stays at the last 1/2/5/6. Bit follows 5/6 only.
        self._door_command = 0
        self._discharge_open = False
        self._cool_fan = False
        self._stirrer = False

    async def connect(self) -> None:
        self._connect_time = time.monotonic()
        self._roasting = False
        self._connected = True
        _log.info("VirtualMachine connected — playing recorded BBP")

    async def disconnect(self) -> None:
        self._connected = False
        self._roasting = False

    async def read(self) -> Reading:
        if not self._connected:
            return Reading(bt=-1.0, et=-1.0, heater=None, fan=0, drum=0, timestamp=time.monotonic())

        reading = self._read_preheat() if not self._roasting else self._read_roasting()
        return self._apply_cmd(reading)

    def _since_connect(self) -> float:
        return time.monotonic() - self._connect_time

    def _read_preheat(self) -> Reading:
        """Charge 전: 실측 BBP, 그 뒤는 같은 배치의 Charge 하락."""
        elapsed = self._since_connect()
        if elapsed < _BBP_END:
            bt, et = _sample(_BBP_PROFILE, elapsed)
        else:
            bt, et = _sample(_ROAST_PROFILE, elapsed - _BBP_END)

        return Reading(
            bt=round(bt + _noise(0.4), 1),
            et=round(et + _noise(0.25), 1),
            heater=60.0,
            fan=20.0,
            drum=50.0,
            timestamp=time.monotonic(),
        )

    async def enter_standby(self) -> None:
        """READY. 온도는 실측 시계를 유지한다."""
        _log.info("VirtualMachine: standby entered")

    def _read_roasting(self) -> Reading:
        """로스팅 단계: 실측 곡선을 절대온도로 재생한다. 화력 명령은 온도를 밀지 않는다."""
        tx = time.monotonic() - self._roast_start_time
        duration = _ROAST_PROFILE["timex"][-1]

        bt = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["bt"]) + _noise(0.4)
        et = _interp(tx, _ROAST_PROFILE["timex"], _ROAST_PROFILE["et"]) + _noise(0.25)

        # 화력은 스크립트가 건드리지 않는다 — 실기처럼 control() 명령으로만 변한다.
        # (자동 스텝다운 스크립트는 배치당 30+회의 가짜 조정 이벤트를 기록에 남겨 삭제)
        heater = 60.0
        fan = min(70.0, 30.0 + (tx / duration) * 40.0) if duration else 30.0
        drum = 50.0

        return Reading(
            bt=round(bt, 1),
            et=round(et, 1),
            heater=round(heater, 1),
            fan=round(fan, 1),
            drum=drum,
            timestamp=time.monotonic(),
        )

    async def start_roast(self) -> None:
        """Charge. BBP가 이미 끝났으면 그 시각의 로스팅 곡선을 이어서 재생한다."""
        elapsed = self._since_connect()
        if elapsed >= _BBP_END:
            self._roast_start_time = self._connect_time + _BBP_END
        else:
            self._roast_start_time = time.monotonic()
        self._roasting = True
        _log.info("VirtualMachine: roasting started — recorded curve")

    async def door_probe(self, write: int | None) -> dict[str, Any]:
        if not self._connected:
            raise ConnectionError("가상 머신이 연결되어 있지 않습니다.")
        if write is not None and write not in (1, 2, 5, 6):
            raise ValueError("W60A door command must be 1, 2, 5, or 6")
        command_before = self._door_command
        discharge_open_before = self._discharge_open
        if write is not None:
            self._door_command = write
            if write == 5:
                self._discharge_open = True
            elif write == 6:
                self._discharge_open = False
        return {
            "wrote": write,
            "command_before": command_before,
            "command_after": self._door_command,
            "command_held": None if write is None else True,
            "discharge_open_before": discharge_open_before,
            "discharge_open_after": self._discharge_open,
        }

    async def cooling_fan_probe(self, on: bool | None) -> dict[str, Any]:
        if not self._connected:
            raise ConnectionError("가상 머신이 연결되어 있지 않습니다.")
        command_before = self._door_command
        fan_before = self._cool_fan
        pulse = None
        if on is not None:
            pulse = 8 if on else 10
            self._door_command = pulse
            self._cool_fan = on
            self._door_command = 0
        return {
            "wrote": pulse,
            "command_before": command_before,
            "command_after": self._door_command,
            "command_held": None if on is None else self._door_command == 0,
            "discharge_open_before": self._discharge_open,
            "discharge_open_after": self._discharge_open,
            "cool_fan_before": fan_before,
            "cool_fan_after": self._cool_fan,
            "cool_fan_held": None if on is None else self._cool_fan is on,
        }

    async def stirrer_probe(self, on: bool | None) -> dict[str, Any]:
        if not self._connected:
            raise ConnectionError("가상 머신이 연결되어 있지 않습니다.")
        command_before = self._door_command
        stirrer_before = self._stirrer
        pulse = None
        if on is not None:
            pulse = 7 if on else 9
            self._door_command = pulse
            self._stirrer = on
            self._door_command = 0
        return {
            "wrote": pulse,
            "command_before": command_before,
            "command_after": self._door_command,
            "command_held": None if on is None else self._door_command == 0,
            "discharge_open_before": self._discharge_open,
            "discharge_open_after": self._discharge_open,
            "stirrer_before": stirrer_before,
            "stirrer_after": self._stirrer,
            "stirrer_held": None if on is None else self._stirrer is on,
        }

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        """명령값을 저장해 이후 read()가 그 값을 되돌려준다.

        온도는 실측 곡선 그대로다. 화력은 표시만 바뀐다.
        """
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

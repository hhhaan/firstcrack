"""1차 지연 열 모델 — 가상 머신이 duty에 실제로 반응하게 만든다.

스크립트 재생만으로는 PID 루프를 검증할 수 없다. duty를 올려도 BT가 그대로면
어떤 게인을 넣어도 테스트가 통과해버린다. 실기 없이 "화력을 올리면 뜨거워지고,
끄면 식는다"는 최소한의 인과를 주는 것이 목적이다.

    dBT/dt = (heater_gain × duty + (ambient − BT)) / tau

로스터의 실제 열역학(드럼 질량, 생두 흡열, 배기)을 재현하지 않는다. PID가
수렴하는지, 진동하지 않는지, duty가 범위를 지키는지 확인할 수 있으면 충분하다.
실기 게인 튜닝은 이 모델로 대신할 수 없다.
"""


class FirstOrderThermalModel:
    def __init__(
        self,
        *,
        tau: float = 40.0,
        heater_gain: float = 2.4,
        ambient: float = 25.0,
        bt0: float = 25.0,
    ) -> None:
        self.tau = tau
        self.heater_gain = heater_gain
        self.ambient = ambient
        self.bt = bt0

    def step(self, duty: float, dt: float) -> float:
        """dt초 동안 duty를 유지했을 때의 BT. dt가 크면 잘게 쪼개 적분한다."""
        if dt <= 0:
            return self.bt
        # 오일러 적분이 발산하지 않도록 스텝을 tau의 1/4 이하로 유지
        max_step = self.tau / 4.0
        remaining = dt
        while remaining > 0:
            step = min(remaining, max_step)
            drive = self.heater_gain * duty + (self.ambient - self.bt)
            self.bt += (drive / self.tau) * step
            remaining -= step
        return self.bt

    @property
    def steady_state(self) -> float:
        """현재는 참고용 — duty=100에서 수렴하는 온도."""
        return self.ambient + self.heater_gain * 100.0

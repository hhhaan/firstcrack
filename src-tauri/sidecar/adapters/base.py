import dataclasses


@dataclasses.dataclass
class Reading:
    bt: float        # Bean Temperature °C  (-1.0 = no data)
    et: float        # Environment Temperature °C
    heater: float | None  # 0-100. None = 이 머신에 화력 피드백 채널이 없다 (0은 측정값 0)
    fan: float       # 0-100
    drum: float      # 0-100 (RPM % or raw speed)
    timestamp: float # time.monotonic()

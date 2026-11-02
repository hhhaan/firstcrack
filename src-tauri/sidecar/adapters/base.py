import dataclasses


@dataclasses.dataclass
class Reading:
    bt: float        # Bean Temperature °C  (-1.0 = no data)
    et: float        # Environment Temperature °C
    heater: float | None  # 0-100. None = 이 머신에 화력 피드백 채널이 없다 (0은 측정값 0)
    fan: float | None  # 0-100. None = 이 머신에 에어 피드백 채널이 없다
    drum: float | None  # RPM or %. None = 이 머신에 드럼 피드백 채널이 없다
    timestamp: float # time.monotonic()
    extra_readings: list[dict[str, str | float | None]] = dataclasses.field(
        default_factory=list
    )

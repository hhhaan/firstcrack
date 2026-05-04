import dataclasses


@dataclasses.dataclass
class Reading:
    bt: float        # Bean Temperature °C  (-1.0 = no data)
    et: float        # Environment Temperature °C
    heater: float    # 0-100
    fan: float       # 0-100
    drum: float      # 0-100 (RPM % or raw speed)
    timestamp: float # time.monotonic()

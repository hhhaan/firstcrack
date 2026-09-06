import dataclasses
from typing import Any


@dataclasses.dataclass
class Reading:
    bt: float        # Bean Temperature °C  (-1.0 = no data)
    et: float        # Environment Temperature °C
    heater: float | None  # 0-100. None = 이 머신에 화력 피드백 채널이 없다 (0은 측정값 0)
    fan: float       # 0-100
    drum: float      # 0-100 (RPM % or raw speed)
    timestamp: float # time.monotonic()


def _exc_parts(exc: Exception) -> tuple[str, str]:
    return str(exc), type(exc).__name__


def format_missing_module(exc: Exception, module: str, hint: str) -> str | None:
    if f"No module named '{module}'" in str(exc):
        return hint
    return None


def format_serial_port_error(exc: Exception, comport: str) -> str | None:
    msg = str(exc)
    if "No such file or directory" in msg or "could not open port" in msg:
        return f"시리얼 포트 '{comport}'를 찾을 수 없습니다. 포트 이름과 케이블 연결을 확인하세요."
    if "Device or resource busy" in msg or "Access is denied" in msg:
        return f"시리얼 포트 '{comport}'가 다른 프로그램에서 사용 중입니다. 다른 앱을 종료 후 다시 시도하세요."
    if "Permission denied" in msg:
        return f"시리얼 포트 '{comport}' 접근 권한이 없습니다. (Linux: sudo usermod -aG dialout $USER)"
    return None


def format_network_error(
    exc: Exception,
    *,
    host: str = "",
    port: Any = "",
    refused: str | None = None,
    timeout: str | None = None,
) -> str | None:
    msg, exc_type = _exc_parts(exc)
    if "Connection refused" in msg:
        return refused or (
            f"연결이 거부됐습니다 ({host}:{port}). 머신 전원과 네트워크 설정을 확인하세요."
        )
    if "timed out" in msg.lower() or exc_type in ("TimeoutError", "asyncio.TimeoutError"):
        return timeout or f"{host} 응답 없음. 머신이 같은 네트워크에 있는지 확인하세요."
    if (
        exc_type == "gaierror"
        or "nodename nor servname" in msg
        or "Name or service not known" in msg
    ):
        return f"호스트({host})를 찾을 수 없습니다. IP 주소를 확인하세요."
    if "Network is unreachable" in msg or "No route to host" in msg:
        return f"호스트({host})에 도달할 수 없습니다. 네트워크 연결을 확인하세요."
    return None


class MachineAdapter:
    """머신 어댑터 계약. 새 프로토콜은 이 클래스를 상속한다.

    writable: control()이 하드웨어에 실제로 쓰는가. 스텁 control은 False.
    enter_standby / start_roast: 없는 동작은 no-op (매니저는 hasattr를 보지 않는다).
    format_connection_error: 연결 오류 카피는 어댑터가 소유한다.
    """

    writable: bool = False

    async def enter_standby(self) -> None:
        return

    async def start_roast(self) -> None:
        return

    def format_connection_error(
        self, exc: Exception, *, first_read_failure: bool = False
    ) -> str:
        host = getattr(self, "_host", "")
        port = getattr(self, "_port", "")
        return format_network_error(exc, host=str(host), port=port) or str(exc)

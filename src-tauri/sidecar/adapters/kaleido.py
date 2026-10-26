import asyncio
import logging
import time
from typing import Any

from adapters.base import Reading
from adapters.kaleido_link import KaleidoLink
from control_guard import ControlUnavailable

_log = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 15.0
_CONNECT_POLL = 0.1
_TEARDOWN_TIMEOUT = 2.0


def _percent(state: dict[str, Any], key: str) -> float:
    if key not in state or state[key] is None:
        return -1.0
    return float(state[key])


class KaleidoAdapter:
    """
    Kaleido 읽기 전용.
    mode="TCP" → WebSocket (port 80, path ws)
    mode="Serial" → 줄 단위 시리얼 (baudrate 57600)

    connect()는 상태 번호와 온도 단위가 들어올 때까지 기다린다.
    세션은 connect마다 새로 만든다. 이전 세션의 측정값이 다음 연결을
    성공으로 보이게 두지 않는다.
    """

    def __init__(
        self,
        mode: str = "TCP",
        host: str = "127.0.0.1",
        port: int = 80,
        path: str = "ws",
        comport: str = "",
        baudrate: int = 57600,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: int = 1,
        timeout: float = 0.6,
        **_: Any,
    ) -> None:
        self._link: KaleidoLink | None = None
        self._mode = mode
        self._host = host
        self._port = port
        self._path = path
        self._comport = comport
        self._baudrate = baudrate
        self._bytesize = bytesize
        self._parity = parity
        self._stopbits = stopbits
        self._timeout = timeout
        self._connected: bool = False

    def _new_link(self) -> KaleidoLink:
        return KaleidoLink()

    def _serial_settings(self) -> dict[str, Any] | None:
        if self._mode.lower() != "serial":
            return None
        if not self._comport:
            raise ValueError("Kaleido Serial 모드: comport가 비어 있음.")
        return {
            "port": self._comport,
            "baudrate": self._baudrate,
            "bytesize": self._bytesize,
            "stopbits": self._stopbits,
            "parity": self._parity,
            "timeout": self._timeout,
        }

    async def connect(self) -> None:
        # 재연결은 같은 차례에 disconnect 없이 connect를 다시 부른다.
        await self._shutdown_link()
        self._connected = False
        link = self._new_link()
        self._link = link
        try:
            await link.start_session(
                unit="C",
                host=self._host,
                port=self._port,
                path=self._path,
                serial=self._serial_settings(),
            )
            # 폴링 대상은 이 지역 변수다. 도중에 self._link가 비워져도
            # 다른 세션의 상태를 성공으로 읽지 않는다.
            deadline = time.monotonic() + _CONNECT_TIMEOUT
            while time.monotonic() < deadline:
                await asyncio.sleep(_CONNECT_POLL)
                state = link.snapshot()
                if state.get("sid") is not None and state.get("TU") is not None:
                    self._connected = True
                    _log.info("Kaleido connected (mode=%s, TU=%s)", self._mode, state.get("TU"))
                    return
            raise ConnectionError(f"Kaleido 핸드셰이크 타임아웃 ({_CONNECT_TIMEOUT}s)")
        except BaseException:
            self._connected = False
            await self._shutdown_link()
            raise

    async def _shutdown_link(self) -> None:
        link = self._link
        if link is None:
            return
        self._link = None
        try:
            await asyncio.wait_for(link.shutdown(), _TEARDOWN_TIMEOUT)
        except TimeoutError:
            _log.warning("Kaleido 세션이 %.1fs 내 종료되지 않음", _TEARDOWN_TIMEOUT)
        except Exception:
            _log.exception("Kaleido shutdown failed")

    async def disconnect(self) -> None:
        await self._shutdown_link()
        self._connected = False

    async def read(self) -> Reading:
        link = self._link
        if link is None or not self._connected:
            raise ConnectionError("Kaleido 드라이버가 연결돼 있지 않습니다.")
        bt, et = await link.read_temperatures()
        state = link.snapshot()
        # 아직 안 들어온 채널은 -1이다. 측정된 0과 구분된다.
        return Reading(
            bt=bt,
            et=et,
            heater=_percent(state, "HP"),
            fan=_percent(state, "FC"),
            drum=_percent(state, "RC"),
            timestamp=time.monotonic(),
        )

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        # TODO: 네트워크/시리얼은 HP·FC·RC 쓰기가 된다. 화력 재현에 붙이려면
        # 이 거절과 WRITABLE_PROTOCOLS, write_map을 같이 열어야 한다.
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._connected

import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading
from control_guard import ControlUnavailable

_log = logging.getLogger(__name__)

# extern/kaleido.py KaleidoPort timeouts: open=6s, init=6s → 넉넉히 15s
_CONNECT_TIMEOUT = 15.0
_CONNECT_POLL = 0.1
# 구 세션 asyncio 루프 스레드 join 대기 시한
_TEARDOWN_TIMEOUT = 2.0


class KaleidoAdapter:
    """
    Kaleido 전용 드라이버 (extern/kaleido.py).
    mode="TCP"    → WebSocket (Network.aset, port 80)
    mode="Serial" → MODBUS RTU (Serial.aset, baudrate 57600)

    connect()은 extern/kaleido.py의 ws_initialize() (Ping→TU→SC) 완료를
    sid + TU 상태 폴링으로 확인한 뒤 반환한다.

    KaleidoPort는 connect()마다 새로 생성한다(세대 격리): _state/_write_queue/
    _pending_requests가 인스턴스마다 분리되므로, 종료가 지연된 구 세션이
    새 세션 상태를 오염시켜 "허위 연결 성공"을 만드는 경로가 사라진다.

    KaleidoPort.getBTET/stop/send_request는 동기 future.result()를 쓰므로
    aiohttp 이벤트 루프를 막지 않도록 to_thread로 오프로드한다.
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
        self._driver: Any | None = None
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

    def _new_driver(self) -> Any:
        """드라이버 팩토리 시임 — 테스트에서 교체 가능.

        import를 connect 경로로 미룬 덕에 websockets 미설치 시
        어댑터 생성(500)이 아니라 연결 실패 메시지 경로를 탄다.
        """
        from extern.kaleido import KaleidoPort

        return KaleidoPort()

    async def connect(self) -> None:
        serial = None
        if self._mode.lower() == "serial":
            if not self._comport:
                raise ValueError("Kaleido Serial 모드: comport가 비어 있음.")
            # extern/kaleido.py의 SerialSettings TypedDict 필드와 1:1 매칭.
            serial = {
                "port": self._comport,
                "baudrate": self._baudrate,
                "bytesize": self._bytesize,
                "stopbits": self._stopbits,
                "parity": self._parity,
                "timeout": self._timeout,
                "clear_HUPCL": False,
            }
        # manager 재연결 루프는 같은 이터레이션에서 disconnect()→connect()를 부른다.
        # 잔여 세션이 남아 있으면 여기서 결정적으로 정리한 뒤 새 세션을 연다.
        await self._teardown_driver()
        self._connected = False  # 핸드셰이크 확정 전까지 "연결됨"을 노출하지 않는다
        driver = self._new_driver()
        self._driver = driver
        try:
            driver.start(
                mode="C",  # 온도 단위(C/F): roaster registry에서 항상 C 모드 가정
                host=self._host,
                port=self._port,
                path=self._path,
                serial=serial,
            )
            # ws_initialize()가 Ping→TU→SC 핸드셰이크를 백그라운드에서 수행.
            # sid와 TU가 모두 설정되면 초기화 완료.
            # 반드시 로컬 `driver`를 본다 — self._driver를 보면 세대 혼동이 되살아난다.
            deadline = time.monotonic() + _CONNECT_TIMEOUT
            while time.monotonic() < deadline:
                await asyncio.sleep(_CONNECT_POLL)
                if driver.get_state("sid") is not None and driver.get_state("TU") is not None:
                    self._connected = True
                    _log.info("Kaleido connected (mode=%s, TU=%s)", self._mode, driver.get_state("TU"))
                    return
            raise ConnectionError(f"Kaleido 핸드셰이크 타임아웃 ({_CONNECT_TIMEOUT}s): Ping→TU→SC 미완료")
        except BaseException:
            # CancelledError도 정리 대상 — 핸드셰이크 중 disconnect가 취소를 걸면
            # 소켓/루프 스레드가 남는다.
            self._connected = False
            await self._teardown_driver()
            raise

    async def _teardown_driver(self) -> None:
        """드라이버 세션을 결정적으로 종료한다 (블로킹이므로 스레드로 오프로드).

        vendor stop()은 `_asyncLoopThread = None`으로 마지막 강참조를 끊어
        __del__ 발화(refcount 우연)에 teardown을 맡긴다. 여기서는 stop() 전에
        핸들을 로컬로 확보해 __del__을 억제하고, 명시적으로 루프 스레드를 join한다.
        """
        driver = self._driver
        if driver is None:
            return
        self._driver = None  # 재진입 방어
        loop_thread = getattr(driver, "_asyncLoopThread", None)
        try:
            await asyncio.to_thread(driver.stop)
        except Exception:
            _log.exception("Kaleido driver.stop() failed")
        if loop_thread is None:
            return
        try:
            stopped = await asyncio.to_thread(loop_thread.stop, _TEARDOWN_TIMEOUT)
        except Exception:
            _log.exception("Kaleido loop thread stop() failed")
            return
        if not stopped:
            # 새 세션은 별도 객체라 오염되지 않는다 — 경고만 남기고 진행.
            _log.warning("Kaleido 구 세션 루프 스레드가 %.1fs 내 종료되지 않음", _TEARDOWN_TIMEOUT)

    async def disconnect(self) -> None:
        await self._teardown_driver()
        self._connected = False

    def _read_sync(self) -> Reading:
        driver = self._driver
        if driver is None:
            raise ConnectionError("Kaleido 드라이버가 연결돼 있지 않습니다.")
        bt, et, _sid = driver.getBTET()
        try:
            hp = float(driver.get_state("HP") or 0)
        except (KeyError, TypeError):
            hp = 0.0
        try:
            fc = float(driver.get_state("FC") or 0)  # fan: FC (not SM)
        except (KeyError, TypeError):
            fc = 0.0
        try:
            drum = float(driver.get_state("RC") or 0)  # drum: RC (not RL)
        except (KeyError, TypeError):
            drum = 0.0
        return Reading(bt=bt, et=et, heater=hp, fan=fc, drum=drum, timestamp=time.monotonic())

    async def read(self) -> Reading:
        return await asyncio.to_thread(self._read_sync)

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._connected

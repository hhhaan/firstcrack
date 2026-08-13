import asyncio
import time
import logging
from typing import Any

from adapters.base import Reading

_log = logging.getLogger(__name__)

# extern/kaleido.py KaleidoPort timeouts: open=6s, init=6s → 넉넉히 15s
_CONNECT_TIMEOUT = 15.0
_CONNECT_POLL = 0.1
_TEARDOWN_TIMEOUT = 2.0


class KaleidoAdapter:
    """
    Kaleido 전용 드라이버 (extern/kaleido.py).
    mode="TCP"    → WebSocket (Network.aset, port 80)
    mode="Serial" → MODBUS RTU (Serial.aset, baudrate 57600)

    connect()은 extern/kaleido.py의 ws_initialize() (Ping→TU→SC) 완료를
    sid + TU 상태 폴링으로 확인한 뒤 반환한다.

    KaleidoPort.getBTET/stop/send_request는 동기 future.result()를 쓰므로
    aiohttp 이벤트 루프를 막지 않도록 to_thread로 오프로드한다.

    연결마다 새 KaleidoPort를 만든다. 이전 세션의 _state/_write_queue가
    새 핸드셰이크를 오염시키지 못하게 한다. teardown은 AsyncLoopThread.stop()
    으로 스레드 join까지 기다린다 (refcount/__del__에 의존하지 않음).
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
        # connect 경로에서만 import — websockets 미설치 시 make_adapter가
        # 500 내기 전에 manager의 연결 실패 메시지를 타게 한다.
        from extern.kaleido import KaleidoPort

        return KaleidoPort()

    async def connect(self) -> None:
        # manager 재연결은 같은 이터레이션에서 disconnect→connect를 부른다.
        await self._teardown_driver()
        # teardown 직후엔 세션이 없다. 핸드셰이크가 끝나기 전에 True를 유지하면
        # 구 sid/TU 오염과 같은 허위 연결이 된다.
        self._connected = False

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

        driver = self._new_driver()
        self._driver = driver
        started = False
        try:
            driver.start(
                mode="C",  # 온도 단위(C/F): roaster registry에서 항상 C 모드 가정
                host=self._host,
                port=self._port,
                path=self._path,
                serial=serial,
            )
            started = True
            # ws_initialize()가 Ping→TU→SC 핸드셰이크를 백그라운드에서 수행.
            # sid와 TU가 모두 설정되면 초기화 완료.
            # 로컬 driver만 본다 — self._driver를 보면 재연결 중 세대 혼동.
            deadline = time.monotonic() + _CONNECT_TIMEOUT
            while time.monotonic() < deadline:
                await asyncio.sleep(_CONNECT_POLL)
                if driver.get_state("sid") is not None and driver.get_state("TU") is not None:
                    self._connected = True
                    _log.info("Kaleido connected (mode=%s, TU=%s)", self._mode, driver.get_state("TU"))
                    return
            raise ConnectionError(f"Kaleido 핸드셰이크 타임아웃 ({_CONNECT_TIMEOUT}s): Ping→TU→SC 미완료")
        except BaseException:
            if started or self._driver is driver:
                await self._teardown_driver()
            self._connected = False
            raise

    async def _teardown_driver(self) -> None:
        """이전 KaleidoPort 세션을 명시적으로 종료한다.

        self._driver = None을 먼저 둬 재진입을 막고, stop() 전에
        _asyncLoopThread 핸들을 로컬에 잡아 __del__이 join보다 먼저
        발화하지 않게 한다. join 실패는 warning만 — 새 세션은 별도 객체.
        """
        driver = self._driver
        self._driver = None
        if driver is None:
            return
        loop_thread = getattr(driver, "_asyncLoopThread", None)
        try:
            await asyncio.to_thread(driver.stop)
        except Exception:
            _log.exception("Kaleido driver.stop() failed")
        if loop_thread is not None:
            try:
                stopped = await asyncio.to_thread(loop_thread.stop, _TEARDOWN_TIMEOUT)
                if not stopped:
                    _log.warning(
                        "Kaleido loop thread did not stop within %.1fs", _TEARDOWN_TIMEOUT
                    )
            except Exception:
                _log.exception("Kaleido loop thread stop() failed")

    async def disconnect(self) -> None:
        await self._teardown_driver()
        self._connected = False

    def _read_sync(self) -> Reading:
        driver = self._driver
        if driver is None:
            raise ConnectionError("Kaleido 드라이버가 없습니다.")
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
        pass  # 제어 기능 미사용 — 제거 예정

    @property
    def connected(self) -> bool:
        return self._connected

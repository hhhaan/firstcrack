import asyncio
import json
import random
import socket
import time
import logging
from typing import Any

from adapters.base import Reading
from control_guard import ControlUnavailable
from protocol_trace import TRACE

_log = logging.getLogger(__name__)


class ProbatWSAdapter:
    """
    Probat WebSocket 어댑터 (G/UG WebSockets, P Series III, Sample Roaster).
    extern/wsport.py는 Qt + ApplicationWindow에 깊게 결합돼 있어 직접 구현.

    프로토콜:
      ws://{host}:{port}/WebSocket
      요청: {"command":"getData","id":<random>,"roasterID":0}
      응답: {"id":<same>,"data":{"beanTemp":210.3,"burner":75,...}}

    channel_nodes: roaster_registry의 "channel_nodes" 딕셔너리.
      {"BT":"beanTemp","ET":"ambientTemp","heater":"burner","fan":"exhaustFan"}
    """

    _WS_PATH = "WebSocket"
    _REQUEST_TIMEOUT = 3.0
    _CONNECT_TIMEOUT = 5.0

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 80,
        channel_nodes: dict[str, str] | None = None,
        **_: Any,
    ) -> None:
        self._host = host
        self._port = port
        self._channel_nodes: dict[str, str] = channel_nodes or {}
        self._ws: Any = None
        self._connected: bool = False

    def _url(self) -> str:
        if self._port == 80:
            return f"ws://{self._host}/{self._WS_PATH}"
        return f"ws://{self._host}:{self._port}/{self._WS_PATH}"

    async def connect(self) -> None:
        import websockets  # type: ignore[import]

        if not self._channel_nodes:
            raise ValueError("channel_nodes가 비어 있음. roaster_registry 확인 필요.")

        self._ws = await asyncio.wait_for(
            websockets.connect(
                self._url(),
                ping_interval=20,
                ping_timeout=20,
                open_timeout=self._CONNECT_TIMEOUT,
                compression="deflate",
                origin=websockets.Origin(f"http://{socket.gethostname()}"),
                user_agent_header="FC-Desktop/1.0 websockets",
            ),
            timeout=self._CONNECT_TIMEOUT,
        )
        self._connected = True
        _log.info("ProbatWSAdapter connected: %s", self._url())

    async def disconnect(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                _log.exception("Probat WS close failed during disconnect: %s", self._url())
                pass
            self._ws = None
        self._connected = False

    async def _on_ws_error(self, exc: Exception) -> ConnectionError:
        """WS 오류 시 소켓을 닫고 상태를 정리한 뒤 ConnectionError로 변환."""
        ws, self._ws = self._ws, None
        self._connected = False
        if ws is not None:
            # _ws를 먼저 비우면 disconnect()의 가드에 걸려 소켓이 고아가 된다
            try:
                await ws.close()
            except Exception:
                _log.exception("Probat WS close failed while handling error: %s", self._url())
                pass
        return ConnectionError(f"Probat WS 연결 끊김: {exc}")

    async def read(self) -> Reading:
        if self._ws is None:
            raise ConnectionError("WebSocket이 연결되지 않음")

        msg_id = random.randint(1, 99999)
        request = json.dumps(
            {"command": "getData", "id": msg_id, "roasterID": 0},
            separators=(",", ":"),
        )
        try:
            TRACE.record("tx", "probat_ws", f"getData id={msg_id}", request)
            await self._ws.send(request)
        except Exception as exc:
            raise await self._on_ws_error(exc) from exc

        deadline = time.monotonic() + self._REQUEST_TIMEOUT
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(
                    self._ws.recv(),
                    timeout=max(0.1, deadline - time.monotonic()),
                )
            except asyncio.TimeoutError:
                break
            except Exception as exc:
                raise await self._on_ws_error(exc) from exc
            try:
                j = json.loads(raw)
            except json.JSONDecodeError:
                _log.warning("Probat WS malformed frame (non-JSON), skipping: %s", self._url())
                continue
            if j.get("id") != msg_id:
                TRACE.record(
                    "info", "probat_ws",
                    f"unmatched id={j.get('id')} (expected {msg_id})", j,
                )
                continue

            TRACE.record("rx", "probat_ws", f"response id={msg_id}", j)
            data: dict[str, Any] = j.get("data", {})
            nodes = self._channel_nodes

            def _get(role: str, default: float | None) -> float | None:
                node = nodes.get(role)
                if node and node in data:
                    try:
                        return round(float(data[node]), 1)
                    except (TypeError, ValueError):
                        _log.warning("Probat WS unparsable value for node=%s: %r", node, data[node])
                        pass
                return default

            return Reading(
                bt=_get("BT", -1.0),
                et=_get("ET", -1.0),
                heater=_get("heater", None),  # burner 노드 미매핑 = 채널 없음
                fan=_get("fan", 0.0),
                drum=_get("drum", 0.0),
                timestamp=time.monotonic(),
            )

        TRACE.record("err", "probat_ws", f"getData 응답 타임아웃 id={msg_id}")
        raise TimeoutError(f"Probat WS getData 응답 타임아웃 (id={msg_id})")

    async def control(self, heater: float | None = None, fan: float | None = None, drum: float | None = None) -> None:
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._connected

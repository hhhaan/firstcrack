"""Kaleido 네트워크·시리얼 세션.

기기가 주고받는 한 줄 프레임만 맞춘다. `{[태그]}` 또는 `{[태그 값]}`을 보내고,
`{상태,이름:값,...}` 응답으로 마지막 측정값을 갱신한다.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Protocol

_log = logging.getLogger(__name__)

_TEXT_TAGS = frozenset({"TU", "SC", "CL", "SN"})
_WHOLE_TAGS = frozenset({"HP", "FC", "RC", "AH", "HS", "EV", "CS"})
_PACE_SECONDS = 0.1
_REPLY_WAIT = 1.2
_SAMPLE_WAIT = 0.6
_CLOSE_WAIT = 1.2
_PING_GAP = 1.0
_READ_STREAM = "A0"


class Pipe(Protocol):
    async def send_line(self, line: str) -> None: ...

    async def next_line(self) -> str: ...

    async def aclose(self) -> None: ...


def frame(tag: str, argument: str | None = None) -> str:
    if argument is None:
        return f"{{[{tag}]}}\n"
    return f"{{[{tag} {argument}]}}\n"


def parse_status(line: str) -> dict[str, str | int | float] | None:
    text = line.strip()
    if len(text) < 3 or text[0] != "{" or text[-1] != "}":
        return None
    fields = [part.strip() for part in text[1:-1].split(",") if part.strip()]
    if not fields:
        return None
    try:
        status_id = int(round(float(fields[0])))
    except ValueError:
        return None
    parsed: dict[str, str | int | float] = {"sid": status_id}
    for field in fields[1:]:
        name, separator, raw = field.partition(":")
        name = name.strip()
        if not separator or not name:
            continue
        parsed[name] = _coerce(name, raw.strip())
    return parsed


def _coerce(name: str, raw: str) -> str | int | float:
    if name in _TEXT_TAGS:
        return raw
    try:
        if name in _WHOLE_TAGS:
            return int(round(float(raw)))
        return float(raw)
    except ValueError:
        return raw


def _as_float(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return -1.0
    return float(value)


class SocketPipe:
    def __init__(self, socket: Any) -> None:
        self._socket = socket

    async def send_line(self, line: str) -> None:
        await self._socket.send(line)

    async def next_line(self) -> str:
        incoming = await self._socket.recv()
        if isinstance(incoming, bytes):
            incoming = incoming.decode("utf-8")
        return str(incoming).strip()

    async def aclose(self) -> None:
        await self._socket.close()


class SerialPipe:
    def __init__(self, port: Any) -> None:
        self._port = port
        self._closed = False

    async def send_line(self, line: str) -> None:
        await asyncio.to_thread(self._port.write, line.encode("ascii"))

    async def next_line(self) -> str:
        def read() -> str:
            while not self._closed:
                raw = self._port.readline()
                if raw:
                    return bytes(raw).decode("utf-8", "replace").strip()
            raise ConnectionError("Kaleido 시리얼이 닫혔습니다.")

        return await asyncio.to_thread(read)

    async def aclose(self) -> None:
        self._closed = True
        with suppress(Exception):
            await asyncio.to_thread(self._port.close)


async def open_kaleido_pipe(
    *,
    host: str,
    port: int,
    path: str,
    serial: dict[str, Any] | None,
) -> Pipe:
    if serial is not None:
        import serial as serial_port

        def open_port() -> Any:
            return serial_port.Serial(
                port=str(serial["port"]),
                baudrate=int(serial.get("baudrate", 57600)),
                bytesize=int(serial.get("bytesize", 8)),
                parity=str(serial.get("parity", "N")),
                stopbits=int(serial.get("stopbits", 1)),
                timeout=float(serial.get("timeout", 0.6)),
            )

        return SerialPipe(await asyncio.to_thread(open_port))

    from websockets.asyncio.client import connect

    socket = await connect(f"ws://{host}:{port}/{path}", open_timeout=6)
    return SocketPipe(socket)


class KaleidoLink:
    """연결 하나. 어댑터가 connect마다 새 인스턴스를 만든다."""

    def __init__(self, opener: Callable[..., Awaitable[Pipe]] | None = None) -> None:
        self._opener = opener or open_kaleido_pipe
        self._values: dict[str, str | int | float] = {}
        self._waiters: dict[str, list[asyncio.Event]] = {}
        self._pipe: Pipe | None = None
        self._send_lock = asyncio.Lock()
        self._boot: asyncio.Task[None] | None = None
        self._reader: asyncio.Task[None] | None = None
        self._closed = False
        self._stopped = False
        self._broken = False

    def snapshot(self) -> dict[str, str | int | float]:
        return dict(self._values)

    async def start_session(
        self,
        *,
        unit: str,
        host: str,
        port: int,
        path: str,
        serial: dict[str, Any] | None,
    ) -> None:
        if self._boot is not None or self._closed:
            return
        self._boot = asyncio.create_task(self._boot_session(unit, host, port, path, serial))

    async def read_temperatures(self) -> tuple[float, float]:
        if self._boot is not None:
            try:
                await self._boot
            except asyncio.CancelledError:
                current = asyncio.current_task()
                if current is not None and current.cancelling():
                    raise
                raise ConnectionError("Kaleido 세션이 닫혔습니다.") from None
            except Exception as error:
                raise ConnectionError("Kaleido 세션이 닫혔습니다.") from error
        if self._closed or self._broken or self._pipe is None:
            raise ConnectionError("Kaleido 세션이 닫혔습니다.")
        if self._values.get("sid") is None or self._values.get("TU") is None:
            return -1.0, -1.0
        try:
            await self._roundtrip("RD", _READ_STREAM, wait_key="BT", timeout=_SAMPLE_WAIT)
        except TimeoutError:
            _log.debug("kaleido sample timed out")
        return _as_float(self._values.get("BT")), _as_float(self._values.get("ET"))

    async def shutdown(self) -> None:
        if self._closed:
            return
        self._closed = True
        established = self._values.get("sid") is not None and self._values.get("TU") is not None
        try:
            if self._boot is not None and not self._boot.done():
                self._boot.cancel()
                with suppress(asyncio.CancelledError):
                    await self._boot
            if established and self._pipe is not None and self._reader is not None and not self._reader.done():
                with suppress(TimeoutError, ConnectionError, OSError):
                    await asyncio.wait_for(
                        self._roundtrip("CL", "AR", wait_key="SN", timeout=_SAMPLE_WAIT),
                        _CLOSE_WAIT,
                    )
        finally:
            await self._halt()

    async def _boot_session(
        self,
        unit: str,
        host: str,
        port: int,
        path: str,
        serial: dict[str, Any] | None,
    ) -> None:
        try:
            self._pipe = await self._opener(host=host, port=port, path=path, serial=serial)
            if self._closed:
                return
            self._reader = asyncio.create_task(self._consume())
            await self._bring_up(unit)
        except asyncio.CancelledError:
            raise
        except Exception:
            _log.exception("kaleido session failed to open")
            self._broken = True

    async def _bring_up(self, unit: str) -> None:
        while not self._stopped and self._values.get("sid") is None:
            try:
                await self._roundtrip("PI", wait_key="sid", timeout=_REPLY_WAIT)
            except TimeoutError:
                await asyncio.sleep(_PING_GAP)
        if self._stopped or self._values.get("sid") is None:
            return
        with suppress(TimeoutError):
            await self._roundtrip("TU", unit, wait_key="TU", timeout=_REPLY_WAIT)
        with suppress(TimeoutError):
            await self._roundtrip("SC", "AR", wait_key="SC", timeout=_REPLY_WAIT)

    async def _roundtrip(
        self,
        tag: str,
        argument: str | None = None,
        *,
        wait_key: str,
        timeout: float,
    ) -> None:
        if self._stopped or self._pipe is None:
            raise ConnectionError("Kaleido 세션이 닫혔습니다.")
        event = asyncio.Event()
        self._waiters.setdefault(wait_key, []).append(event)
        try:
            async with self._send_lock:
                if self._stopped or self._pipe is None:
                    raise ConnectionError("Kaleido 세션이 닫혔습니다.")
                await self._pipe.send_line(frame(tag, argument))
                await asyncio.sleep(_PACE_SECONDS)
            await asyncio.wait_for(event.wait(), timeout)
        finally:
            pending = self._waiters.get(wait_key, [])
            if event in pending:
                pending.remove(event)

    async def _consume(self) -> None:
        pipe = self._pipe
        if pipe is None:
            return
        try:
            while not self._stopped:
                line = await pipe.next_line()
                parsed = parse_status(line)
                if parsed is None:
                    continue
                self._values.update(parsed)
                for key in parsed:
                    for waiter in self._waiters.get(key, ()):
                        waiter.set()
        except asyncio.CancelledError:
            raise
        except Exception:
            _log.exception("kaleido session read ended")
            self._broken = True

    async def _halt(self) -> None:
        self._stopped = True
        reader = self._reader
        self._reader = None
        if reader is not None and not reader.done():
            reader.cancel()
            with suppress(asyncio.CancelledError):
                await reader
        pipe = self._pipe
        self._pipe = None
        if pipe is not None:
            with suppress(Exception):
                await pipe.aclose()

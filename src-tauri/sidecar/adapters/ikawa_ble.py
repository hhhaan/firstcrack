"""IKAWA Home / Pro / Pro X over BLE.

One client. If the official app already holds the radio, connect fails and the
error says so — there is no second path. Polling is request-response:
`MACH_STATUS_GET_ALL` on the write characteristic, reply on notify.

Live heater/fan writes and profile upload are intentionally absent.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

from adapters.base import Reading
from adapters.ikawa_codec import (
    MACH_STATUS_GET_ALL,
    NOTIFY_UUID,
    WRITE_UUID,
    IkawaResponse,
    NotifyReassembler,
    advance_seq,
    chunk_frame,
    decode_frame,
    decode_response,
    encode_cmd,
    encode_frame,
    match_ikawa,
    scale_status,
)
from control_guard import ControlUnavailable

_log = logging.getLogger(__name__)

_SCAN_TIMEOUT = 8.0
_RESPONSE_TIMEOUT = 1.5

_NOT_FOUND = "IKAWA 로스터를 찾지 못했습니다. 전원이 켜져 있고 이름 접두사가 IKAWA인지 확인하세요."
_CONNECT_FAIL = "IKAWA BLE 연결에 실패했습니다. 공식 앱이 연결되어 있으면 먼저 연결을 끊으세요."
_NO_RESPONSE = "IKAWA 응답이 없습니다. 공식 앱이 연결되어 있으면 먼저 연결을 끊으세요."
_NO_EXHAUST = "IKAWA 배기 온도가 응답에 없습니다."
_NOT_CONNECTED = "IKAWA가 연결돼 있지 않습니다."
_BLEAK_MISSING = "bleak 라이브러리가 설치되지 않았습니다."


def _import_bleak() -> tuple[Any, type[BaseException], Any]:
    try:
        from bleak import BleakClient, BleakError, BleakScanner
    except ModuleNotFoundError as exc:
        raise ConnectionError(_BLEAK_MISSING) from exc
    return BleakClient, BleakError, BleakScanner


async def _default_scan(timeout: float) -> list[tuple[Any, Any]]:
    _, _, scanner = _import_bleak()
    found = await scanner.discover(timeout=timeout, return_adv=True)
    devices: list[tuple[Any, Any]] = []
    if isinstance(found, dict):
        for item in found.values():
            if isinstance(item, tuple) and len(item) == 2:
                devices.append((item[0], item[1]))
            else:
                devices.append((item, None))
        return devices
    for dev in found:
        devices.append((dev, None))
    return devices


def _default_client(device: Any) -> Any:
    client_cls, _, _ = _import_bleak()
    return client_cls(device)


def _is_bleak_error(exc: BaseException) -> bool:
    """True for BleakError and its subclasses. Exact class-name checks miss those."""
    try:
        _, bleak_error, _ = _import_bleak()
    except ConnectionError:
        return False
    return isinstance(exc, bleak_error)


class IkawaBleAdapter:
    def __init__(
        self,
        temp_below: str = "exhaust",
        address: str = "",
        *,
        _scan: Callable[[float], Any] | None = None,
        _client_factory: Callable[[Any], Any] | None = None,
        **_: Any,
    ) -> None:
        if temp_below not in ("exhaust", "inlet"):
            raise ValueError(f"temp_below must be exhaust or inlet, got {temp_below!r}")
        self._temp_below = temp_below
        self._address = (address or "").strip()
        self._scan = _scan or _default_scan
        self._client_factory = _client_factory or _default_client
        self._client: Any | None = None
        self._seq = 1
        self._reassembler = NotifyReassembler()
        self._pending: asyncio.Future[IkawaResponse] | None = None
        self._pending_seq = 0
        self._read_lock = asyncio.Lock()
        self._connected = False

    async def connect(self) -> None:
        device = await self._find()
        client = self._client_factory(device)
        try:
            await client.connect()
        except ConnectionError:
            raise
        except (TimeoutError, OSError) as exc:
            raise ConnectionError(_CONNECT_FAIL) from exc
        except Exception as exc:
            if not _is_bleak_error(exc):
                raise
            raise ConnectionError(_CONNECT_FAIL) from exc
        if not getattr(client, "is_connected", False):
            raise ConnectionError(_CONNECT_FAIL)
        self._client = client
        self._seq = 1
        self._reassembler = NotifyReassembler()
        await client.start_notify(NOTIFY_UUID, self._on_notify)
        self._connected = True

    async def _find(self) -> Any:
        try:
            discovered = await self._scan(_SCAN_TIMEOUT)
        except ConnectionError:
            raise
        except ModuleNotFoundError as exc:
            raise ConnectionError(_BLEAK_MISSING) from exc
        matches: list[Any] = []
        for item in discovered:
            device, adv = item if isinstance(item, tuple) else (item, None)
            name = getattr(device, "name", None)
            address = str(getattr(device, "address", "") or "")
            uuids = list(getattr(adv, "service_uuids", None) or [])
            if match_ikawa(name, uuids, address, self._address):
                matches.append(device)
        if not matches:
            raise ConnectionError(_NOT_FOUND)
        matches.sort(key=lambda dev: (str(getattr(dev, "name", "") or ""), str(getattr(dev, "address", "") or "")))
        if len(matches) > 1:
            # ponytail: first name/address wins. Upgrade path: return the list to the UI.
            _log.warning(
                "IKAWA BLE가 %d대 보입니다. %s 를 사용합니다.",
                len(matches),
                getattr(matches[0], "address", ""),
            )
        return matches[0]

    def _on_notify(self, sender: Any, data: bytes | bytearray | None = None) -> None:
        chunk = data if isinstance(data, (bytes, bytearray)) else sender
        if not isinstance(chunk, (bytes, bytearray)):
            return
        pending = self._pending
        for frame in self._reassembler.feed(bytes(chunk)):
            try:
                response = decode_response(decode_frame(frame))
            except ValueError:
                _log.debug("IKAWA notify dropped", exc_info=True)
                continue
            if pending is not None and not pending.done() and response.seq == self._pending_seq:
                pending.set_result(response)

    async def disconnect(self) -> None:
        client = self._client
        self._connected = False
        self._client = None
        pending = self._pending
        self._pending = None
        if pending is not None and not pending.done():
            pending.cancel()
        if client is None:
            return
        try:
            await client.disconnect()
        except Exception:
            _log.debug("IKAWA disconnect", exc_info=True)

    async def read(self) -> Reading:
        if not self._connected or self._client is None:
            raise ConnectionError(_NOT_CONNECTED)
        async with self._read_lock:
            seq = self._seq
            # Advance before the reply. A late notify must not satisfy the next poll.
            # Ceiling: one in-flight command; a reply that arrives after the next
            # send is dropped. Upgrade path: queue replies by seq.
            self._seq = advance_seq(seq)
            loop = asyncio.get_running_loop()
            future: asyncio.Future[IkawaResponse] = loop.create_future()
            self._pending = future
            self._pending_seq = seq
            try:
                frame = encode_frame(encode_cmd(MACH_STATUS_GET_ALL, seq))
                for part in chunk_frame(frame):
                    await self._client.write_gatt_char(WRITE_UUID, part, response=True)
                response = await asyncio.wait_for(future, _RESPONSE_TIMEOUT)
            except TimeoutError as exc:
                raise ConnectionError(_NO_RESPONSE) from exc
            except ConnectionError:
                raise
            except OSError as exc:
                self._connected = False
                raise ConnectionError(_CONNECT_FAIL) from exc
            except Exception as exc:
                if not _is_bleak_error(exc):
                    raise
                self._connected = False
                raise ConnectionError(_CONNECT_FAIL) from exc
            finally:
                if not future.done():
                    future.cancel()
                if self._pending is future:
                    self._pending = None
            if response.status is None:
                raise ConnectionError(_NO_EXHAUST)
            channels = scale_status(response.status, self._temp_below)
            if channels.exhaust_c is None:
                raise ConnectionError(_NO_EXHAUST)
            return Reading(
                bt=channels.exhaust_c,
                et=-1.0 if channels.inlet_c is None else channels.inlet_c,
                heater=channels.heater_pct,
                fan=0.0 if channels.fan_pct is None else channels.fan_pct,
                drum=0.0,
                timestamp=time.monotonic(),
                setpoint=channels.setpoint_c,
            )

    async def control(
        self,
        heater: float | None = None,
        fan: float | None = None,
        drum: float | None = None,
    ) -> None:
        raise ControlUnavailable("이 머신은 제어 쓰기를 지원하지 않습니다.")

    @property
    def connected(self) -> bool:
        return self._connected

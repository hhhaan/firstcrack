"""IKAWA BLE frame codec.

Framing matches libikawa (`encode_frame` / `decode_frame` / `crc16`) and Artisan
`IKAWA_BLE`: 0x7E wrap, 0x7D escape, CRC16 (init 0xFFFF) over the unescaped
payload, big-endian CRC appended before escape. Notify reassembly follows
libikawa's buffer (keep the closing 0x7E, then consume it).

Payload is protobuf `Cmd` / `Response`. Only `MACH_STATUS_GET_ALL` (cmd 11) is
encoded. Seq 0 is reserved: the firmware treats an empty bootloader command as
seq 0, so the first command is seq 1.
"""

from __future__ import annotations

from dataclasses import dataclass

FRAME_BYTE = 0x7E
ESCAPE_BYTE = 0x7D
ESCAPE_MAPPING = {0x7D: 0x5D, 0x7E: 0x5E}
UNESCAPE_MAPPING = {0x5D: 0x7D, 0x5E: 0x7E}

WRITE_CHUNK = 20
SEQ_MOD = 32767

SERVICE_UUID = "C92A6046-6C8D-4116-9D1D-D20A8F6A245F"
NOTIFY_UUID = "948C5059-7F00-46D9-AC55-BF090AE066E3"
WRITE_UUID = "851A4582-19C1-4E6C-AB37-E7A03766BA16"
NAME_PREFIX = "IKAWA"

MACH_STATUS_GET_ALL = 11

# RespMachStatusGetAll field numbers (IkawaCmd.proto / ikawa.proto).
_F_TEMP_ABOVE = 2
_F_FAN = 3
_F_STATE = 4
_F_HEATER = 5
_F_SETPOINT = 9
_F_FAN_MEASURED = 10
_F_BOARD_TEMP = 11
_F_TEMP_BELOW = 12
_F_TEMP_ABOVE_FILTERED = 22
_F_TEMP_BELOW_FILTERED = 23
_F_HUMIDITY_ABS = 26
_F_HUMIDITY_ROC = 27
_F_PRESSURE_AMB = 29

_RESP_SEQ = 1
_RESP_STATUS = 13


def crc16(data: bytes, init_value: int = 0xFFFF) -> bytes:
    crc = init_value
    for byte in data:
        x = (byte & 255) ^ (crc & 255)
        y = x ^ ((x << 4) & 255)
        crc = ((((crc >> 8) & 255) | ((y << 8) & 65535)) ^ (y >> 4)) ^ ((y << 3) & 65535)
    return int(crc & 65535).to_bytes(2, "big")


def escape(data: bytes) -> bytes:
    out = bytearray()
    for byte in data:
        mapped = ESCAPE_MAPPING.get(byte)
        if mapped is None:
            out.append(byte)
        else:
            out.append(ESCAPE_BYTE)
            out.append(mapped)
    return bytes(out)


def unescape(data: bytes) -> bytes:
    out = bytearray()
    it = iter(data)
    for byte in it:
        if byte != ESCAPE_BYTE:
            out.append(byte)
            continue
        nxt = next(it, None)
        if nxt not in UNESCAPE_MAPPING:
            raise ValueError("IKAWA escape sequence is truncated")
        out.append(UNESCAPE_MAPPING[nxt])
    return bytes(out)


def encode_frame(data: bytes) -> bytes:
    """Wrap payload. CRC is computed on `data` before any escape byte is inserted."""
    return bytes([FRAME_BYTE]) + escape(data) + escape(crc16(data)) + bytes([FRAME_BYTE])


def decode_frame(framed: bytes) -> bytes:
    if len(framed) < 4 or framed[0] != FRAME_BYTE or framed[-1] != FRAME_BYTE:
        raise ValueError("IKAWA frame format is invalid")
    raw = unescape(framed[1:-1])
    if len(raw) < 2:
        raise ValueError("IKAWA frame is missing a CRC")
    payload, received = raw[:-2], raw[-2:]
    if received != crc16(payload):
        raise ValueError("IKAWA CRC check failed")
    return payload


def chunk_frame(frame: bytes, size: int = WRITE_CHUNK) -> list[bytes]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    return [frame[i : i + size] for i in range(0, len(frame), size)]


class NotifyReassembler:
    """Split BLE notifies back into 0x7E frames. Matches libikawa's buffer deletes."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self.buf += data
        frames: list[bytes] = []
        while True:
            try:
                frame_start = self.buf.index(FRAME_BYTE)
                frame_end = frame_start + self.buf[frame_start + 1 :].index(FRAME_BYTE) + 1
            except ValueError:
                break
            frame = bytes(self.buf[frame_start : frame_end + 1])
            del self.buf[:frame_end]
            if len(frame) < 3:
                continue
            del self.buf[0]
            frames.append(frame)
        return frames


def _encode_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint must be non-negative")
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _read_varint(buf: bytes, index: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while index < len(buf):
        byte = buf[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, index
        shift += 7
        if shift > 63:
            raise ValueError("IKAWA varint is too long")
    raise ValueError("IKAWA varint is truncated")


def _as_int64(value: int) -> int:
    if value >= 1 << 63:
        return value - (1 << 64)
    return value


def _zigzag_decode(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def advance_seq(seq: int) -> int:
    """Artisan wraps with `% 32767`, which yields 0. Seq 0 is skipped."""
    nxt = (seq + 1) % SEQ_MOD
    return 1 if nxt == 0 else nxt


def encode_cmd(cmd_type: int, seq: int) -> bytes:
    """`Cmd.cmd_type` (field 1) + `Cmd.seq` (field 2). No other command body."""
    if seq <= 0:
        raise ValueError("IKAWA seq must start at 1")
    return bytes([0x08]) + _encode_varint(cmd_type) + bytes([0x10]) + _encode_varint(seq)


def decode_cmd(payload: bytes) -> tuple[int, int]:
    fields = _decode_fields(payload)
    cmd = fields.get(1)
    seq = fields.get(2)
    if not isinstance(cmd, int) or not isinstance(seq, int):
        raise ValueError("IKAWA command is missing cmd_type or seq")
    return _as_int64(cmd), _as_int64(seq)


def _decode_fields(buf: bytes) -> dict[int, int | bytes]:
    out: dict[int, int | bytes] = {}
    index = 0
    while index < len(buf):
        tag, index = _read_varint(buf, index)
        field, wire = tag >> 3, tag & 7
        if wire == 0:
            value, index = _read_varint(buf, index)
            out[field] = value
        elif wire == 2:
            length, index = _read_varint(buf, index)
            end = index + length
            if end > len(buf):
                raise ValueError("IKAWA length-delimited field is truncated")
            out[field] = buf[index:end]
            index = end
        elif wire == 1:
            index += 8
        elif wire == 5:
            index += 4
        else:
            raise ValueError(f"IKAWA wire type {wire} is unsupported")
        if index > len(buf):
            raise ValueError("IKAWA protobuf field overruns the buffer")
    return out


@dataclass(frozen=True)
class IkawaResponse:
    seq: int
    status: dict[int, int] | None


def decode_response(payload: bytes) -> IkawaResponse:
    fields = _decode_fields(payload)
    seq_raw = fields.get(_RESP_SEQ)
    seq = _as_int64(seq_raw) if isinstance(seq_raw, int) else 0
    status_raw = fields.get(_RESP_STATUS)
    if not isinstance(status_raw, (bytes, bytearray)):
        return IkawaResponse(seq=seq, status=None)
    status: dict[int, int] = {}
    for key, value in _decode_fields(bytes(status_raw)).items():
        if isinstance(value, int):
            status[key] = value
    return IkawaResponse(seq=seq, status=status)


def _temp(fields: dict[int, int], raw_field: int, filtered_field: int) -> float | None:
    if raw_field in fields:
        return _as_int64(fields[raw_field]) / 10
    if filtered_field in fields:
        return _as_int64(fields[filtered_field]) / 10
    return None


@dataclass(frozen=True)
class IkawaChannels:
    exhaust_c: float | None
    inlet_c: float | None
    setpoint_c: float | None
    fan_pct: float | None
    fan_rpm: float | None
    heater_pct: float | None
    state: int | None
    humidity_abs: float | None
    humidity_roc: float | None
    board_temp_c: float | None
    pressure_amb: float | None


def scale_status(fields: dict[int, int], temp_below: str) -> IkawaChannels:
    """HOME: temp_below is exhaust. PRO / PRO X: temp_below is inlet.

    Filtered temps are used only when the raw field is absent on the wire.
    """
    below = _temp(fields, _F_TEMP_BELOW, _F_TEMP_BELOW_FILTERED)
    above = _temp(fields, _F_TEMP_ABOVE, _F_TEMP_ABOVE_FILTERED)
    if temp_below == "exhaust":
        exhaust, inlet = below, above
    elif temp_below == "inlet":
        exhaust, inlet = above, below
    else:
        raise ValueError(f"temp_below must be exhaust or inlet, got {temp_below!r}")

    fan = _as_int64(fields[_F_FAN]) if _F_FAN in fields else None
    heater = _as_int64(fields[_F_HEATER]) if _F_HEATER in fields else None
    setpoint = _as_int64(fields[_F_SETPOINT]) if _F_SETPOINT in fields else None
    measured = _as_int64(fields[_F_FAN_MEASURED]) if _F_FAN_MEASURED in fields else None
    state = _as_int64(fields[_F_STATE]) if _F_STATE in fields else None
    board = _as_int64(fields[_F_BOARD_TEMP]) if _F_BOARD_TEMP in fields else None
    humidity = _as_int64(fields[_F_HUMIDITY_ABS]) if _F_HUMIDITY_ABS in fields else None
    humidity_roc = _zigzag_decode(fields[_F_HUMIDITY_ROC]) if _F_HUMIDITY_ROC in fields else None
    pressure = _as_int64(fields[_F_PRESSURE_AMB]) if _F_PRESSURE_AMB in fields else None

    return IkawaChannels(
        exhaust_c=exhaust,
        inlet_c=inlet,
        setpoint_c=None if setpoint is None else setpoint / 10,
        fan_pct=None if fan is None else float(int(round(fan / 2.55))),
        fan_rpm=None if measured is None else measured / 12 * 60,
        heater_pct=None if heater is None else float(heater * 2),
        state=state,
        humidity_abs=None if humidity is None else humidity / 100,
        humidity_roc=None if humidity_roc is None else humidity_roc / 10,
        board_temp_c=None if board is None else board / 10,
        pressure_amb=None if pressure is None else float(pressure),
    )


def match_ikawa(
    name: str | None,
    service_uuids: list[str] | None,
    address: str,
    wanted_address: str,
) -> bool:
    """Name prefix IKAWA. Empty advertised UUID list still matches.

    A non-empty list must include the IKAWA service. `wanted_address` pins one
    peripheral when several advertise the prefix.
    """
    if wanted_address and address.lower() != wanted_address.lower():
        return False
    if not name or not name.upper().startswith(NAME_PREFIX):
        return False
    if service_uuids:
        wanted = SERVICE_UUID.lower()
        if wanted not in {uuid.lower() for uuid in service_uuids}:
            return False
    return True

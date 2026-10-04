"""IKAWA BLE frame codec, scales, and adapter. No radio."""

from pathlib import Path

import pytest

from adapters import WRITABLE_PROTOCOLS
from adapters.base import Reading
from adapters.ikawa_ble import IkawaBleAdapter
from adapters.ikawa_codec import (
    MACH_STATUS_GET_ALL,
    NotifyReassembler,
    advance_seq,
    chunk_frame,
    crc16,
    decode_cmd,
    decode_frame,
    decode_response,
    encode_cmd,
    encode_frame,
    match_ikawa,
    scale_status,
)
from control_guard import ControlUnavailable
from manager import _format_connection_error
from roaster_registry import ROASTER_REGISTRY
from tests.conftest import FakeAdapter, make_reading

_SIDECAR = Path(__file__).resolve().parents[1]


def _varint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value & 0x7F)
    return bytes(out)


def _field(field: int, value: int) -> bytes:
    return _varint((field << 3) | 0) + _varint(value)


def pack_status(seq: int, fields: dict[int, int]) -> bytes:
    body = b"".join(_field(number, value) for number, value in fields.items())
    return _field(1, seq) + _varint((13 << 3) | 2) + _varint(len(body)) + body


def _sample_fields(overrides: dict[int, int] | None = None) -> dict[int, int]:
    fields = {
        2: 1800,  # temp_above
        3: 255,  # fan
        4: 3,  # roasting
        5: 40,  # heater
        9: 1900,  # setpoint
        10: 120,  # fan_measured
        12: 2000,  # temp_below
    }
    if overrides:
        fields.update(overrides)
    return fields


class _Dev:
    def __init__(self, name: str, address: str) -> None:
        self.name = name
        self.address = address


class _Adv:
    def __init__(self, uuids: list[str] | None) -> None:
        self.service_uuids = uuids


class _FakeClient:
    def __init__(self, fields: dict[int, int] | None, *, fail: BaseException | None = None, connected: bool = True):
        self.fields = fields
        self.fail = fail
        self.is_connected = False
        self._connected_flag = connected
        self.writes: list[bytes] = []
        self.seqs: list[int] = []
        self.respond = True
        self._notify = None
        self._reassembler = NotifyReassembler()

    async def connect(self) -> None:
        if self.fail is not None:
            raise self.fail
        self.is_connected = self._connected_flag

    async def disconnect(self) -> None:
        self.is_connected = False

    async def start_notify(self, _uuid, callback) -> None:
        self._notify = callback

    async def write_gatt_char(self, _uuid, data, response: bool = True) -> None:
        chunk = bytes(data)
        assert len(chunk) <= 20
        assert response is True
        self.writes.append(chunk)
        for frame in self._reassembler.feed(chunk):
            _cmd, seq = decode_cmd(decode_frame(frame))
            self.seqs.append(seq)
            if not self.respond or self.fields is None or self._notify is None:
                continue
            reply = encode_frame(pack_status(seq, self.fields))
            for part in chunk_frame(reply):
                self._notify(None, part)


def _adapter(client: _FakeClient, temp_below: str = "exhaust", address: str = "", devices=None) -> IkawaBleAdapter:
    found = devices if devices is not None else [(_Dev("IKAWA Home", "AA:BB"), _Adv([]))]

    async def scan(_timeout: float):
        return found

    return IkawaBleAdapter(
        temp_below=temp_below,
        address=address,
        _scan=scan,
        _client_factory=lambda _device: client,
    )


class TestFrameCodec:
    def test_crc_and_status_command_roundtrip(self):
        payload = encode_cmd(MACH_STATUS_GET_ALL, 1)
        assert payload == bytes.fromhex("080b1001")
        assert crc16(payload) == bytes.fromhex("4b47")
        frame = encode_frame(payload)
        assert frame == bytes.fromhex("7e080b10014b477e")
        assert decode_frame(frame) == payload

    def test_escapes_flag_bytes_before_crc_check(self):
        payload = bytes([0x01, 0x7E, 0x02, 0x7D])
        assert crc16(payload) == bytes.fromhex("148b")
        frame = encode_frame(payload)
        assert frame == bytes.fromhex("7e017d5e027d5d148b7e")
        assert decode_frame(frame) == payload

    def test_crc_mismatch_and_truncated_escape_fail(self):
        frame = bytearray(encode_frame(b"\x01\x02"))
        frame[-2] ^= 0xFF
        with pytest.raises(ValueError, match="CRC"):
            decode_frame(bytes(frame))
        with pytest.raises(ValueError, match="escape"):
            decode_frame(bytes([0x7E, 0x01, 0x7D, 0x7E]))

    def test_seq_varint_and_wrap_skips_zero(self):
        assert encode_cmd(11, 300) == bytes([0x08, 0x0B, 0x10, 0xAC, 0x02])
        assert advance_seq(1) == 2
        assert advance_seq(32766) == 1
        with pytest.raises(ValueError):
            encode_cmd(11, 0)

    def test_chunks_are_20_bytes_and_reassemble_across_an_escape_pair(self):
        payload = bytes([0x11]) * 40 + bytes([0x7E, 0x7D])
        frame = encode_frame(payload)
        parts = chunk_frame(frame)
        assert all(len(part) <= 20 for part in parts)
        assert max(len(part) for part in parts) == 20
        assert b"".join(parts) == frame

        escaped = frame[1:-1]
        split_at = escaped.index(bytes([0x7D, 0x5E])) + 1  # between 0x7D and 0x5E
        cut = 1 + split_at
        reassembler = NotifyReassembler()
        assert reassembler.feed(frame[:cut]) == []
        frames = reassembler.feed(frame[cut:])
        assert frames == [frame]
        assert decode_frame(frames[0]) == payload

    def test_short_flag_pair_is_discarded_and_bad_crc_does_not_stick(self):
        good = encode_frame(b"\x08\x0b\x10\x01")
        reassembler = NotifyReassembler()
        assert reassembler.feed(bytes([0x7E, 0x7E])) == []
        frames = reassembler.feed(good)
        assert decode_frame(frames[0]) == b"\x08\x0b\x10\x01"
        broken = bytearray(good)
        broken[-2] ^= 0x01
        assert reassembler.feed(bytes(broken)) == [bytes(broken)]
        with pytest.raises(ValueError):
            decode_frame(bytes(broken))
        assert decode_frame(reassembler.feed(good)[0]) == b"\x08\x0b\x10\x01"


class TestScales:
    def test_home_and_pro_swap_below_and_above(self):
        fields = _sample_fields()
        home = scale_status(fields, "exhaust")
        pro = scale_status(fields, "inlet")
        assert (home.exhaust_c, home.inlet_c) == (200.0, 180.0)
        assert (pro.exhaust_c, pro.inlet_c) == (180.0, 200.0)
        assert home.setpoint_c == 190.0
        assert home.fan_pct == 100.0
        assert home.heater_pct == 80.0
        assert home.fan_rpm == 600.0
        assert home.state == 3

    def test_filtered_temp_is_used_only_when_raw_is_absent(self):
        fields = _sample_fields()
        del fields[12]
        fields[23] = 2100
        scaled = scale_status(fields, "exhaust")
        assert scaled.exhaust_c == 210.0
        both = scale_status(_sample_fields({23: 2100}), "exhaust")
        assert both.exhaust_c == 200.0

    def test_fan_rounds_like_artisan_and_optional_fields_can_be_missing(self):
        scaled = scale_status(_sample_fields({3: 128, 4: 6}), "inlet")
        assert scaled.fan_pct == 50.0
        assert scaled.state == 6
        assert scaled.humidity_abs is None
        assert scaled.pressure_amb is None
        assert scaled.board_temp_c is None
        bare = {2: 1000, 12: 1100}
        assert scale_status(bare, "exhaust").heater_pct is None
        assert scale_status(bare, "exhaust").fan_pct is None
        assert scale_status({**bare, 5: 0}, "exhaust").heater_pct == 0.0

    def test_optional_environment_fields(self):
        # humidity_roc is sint32 zigzag. value 10 → wire 20 → 1.0 after /10.
        fields = _sample_fields({11: 350, 26: 1234, 27: 20, 29: 1013})
        scaled = scale_status(fields, "inlet")
        assert scaled.board_temp_c == 35.0
        assert scaled.humidity_abs == pytest.approx(12.34)
        assert scaled.humidity_roc == pytest.approx(1.0)
        assert scaled.pressure_amb == 1013.0

    def test_status_response_roundtrip(self):
        payload = pack_status(7, _sample_fields())
        parsed = decode_response(payload)
        assert parsed.seq == 7
        assert parsed.status is not None
        assert scale_status(parsed.status, "exhaust").exhaust_c == 200.0


class TestAdapter:
    async def test_read_scales_home_and_chunks_the_write(self):
        client = _FakeClient(_sample_fields())
        adapter = _adapter(client, temp_below="exhaust")
        await adapter.connect()
        reading = await adapter.read()
        assert client.seqs == [1]
        assert all(len(chunk) <= 20 for chunk in client.writes)
        assert reading.bt == 200.0
        assert reading.et == 180.0
        assert reading.heater == 80.0
        assert reading.fan == 100.0
        assert reading.drum == 0.0
        assert reading.setpoint == 190.0

    async def test_pro_mapping_and_seq_advances_after_a_timeout(self, monkeypatch):
        monkeypatch.setattr("adapters.ikawa_ble._RESPONSE_TIMEOUT", 0.05)
        client = _FakeClient(_sample_fields())
        client.respond = False
        adapter = _adapter(client, temp_below="inlet")
        await adapter.connect()
        with pytest.raises(ConnectionError, match="공식 앱") as exc:
            await adapter.read()
        assert "timed out" not in str(exc.value).lower()
        client.respond = True
        reading = await adapter.read()
        assert client.seqs == [1, 2]
        assert reading.bt == 180.0
        assert reading.et == 200.0

    async def test_missing_exhaust_is_a_connection_error(self):
        fields = _sample_fields()
        del fields[12]
        client = _FakeClient(fields)
        adapter = _adapter(client)
        await adapter.connect()
        with pytest.raises(ConnectionError, match="배기"):
            await adapter.read()

    async def test_missing_inlet_is_the_et_sentinel_and_heater_zero_is_kept(self):
        fields = _sample_fields()
        del fields[2]
        fields[5] = 0
        del fields[3]
        client = _FakeClient(fields)
        adapter = _adapter(client)
        await adapter.connect()
        reading = await adapter.read()
        assert reading.et == -1.0
        assert reading.heater == 0.0
        assert reading.fan == 0.0

    async def test_official_app_and_scan_miss_are_distinct(self):
        busy = _FakeClient(None, fail=TimeoutError("timed out"))
        adapter = _adapter(busy)
        with pytest.raises(ConnectionError, match="공식 앱") as exc:
            await adapter.connect()
        assert "timed out" not in str(exc.value).lower()

        missing = _adapter(_FakeClient(None), devices=[])
        with pytest.raises(ConnectionError, match="찾지 못했습니다"):
            await missing.connect()

    async def test_address_pins_one_and_prefix_is_case_insensitive(self):
        devices = [
            (_Dev("IKAWA-B", "BB:02"), _Adv([])),
            (_Dev("ikawa-a", "AA:01"), _Adv(["c92a6046-6c8d-4116-9d1d-d20a8f6a245f"])),
            (_Dev("OTHER", "CC:03"), _Adv([])),
        ]
        chosen = {}

        client = _FakeClient(_sample_fields())

        async def scan(_timeout: float):
            return devices

        def factory(device: _Dev) -> _FakeClient:
            chosen["device"] = device
            return client

        adapter = IkawaBleAdapter(address="aa:01", _scan=scan, _client_factory=factory)
        await adapter.connect()
        assert chosen["device"].address == "AA:01"
        assert match_ikawa("not-ikawa", [], "AA", "") is False
        assert match_ikawa("IKAWA", ["00000000-0000-0000-0000-000000000000"], "AA", "") is False

    async def test_control_is_unavailable_and_bad_role_fails_closed(self):
        with pytest.raises(ValueError):
            IkawaBleAdapter(temp_below="bean")
        adapter = IkawaBleAdapter()
        with pytest.raises(ControlUnavailable):
            await adapter.control(heater=10)

    def test_source_has_no_profile_set(self):
        text = "\n".join(
            path.read_text()
            for path in (
                _SIDECAR / "adapters" / "ikawa_ble.py",
                _SIDECAR / "adapters" / "ikawa_codec.py",
            )
        )
        assert "PROFILE_SET" not in text
        assert "profile_set" not in text
        assert "MACH_STATUS_GET_ALL = 11" in text


class TestRegistryAndManager:
    def test_three_models_share_the_read_only_protocol(self):
        home = ROASTER_REGISTRY["ikawa_home"]
        pro = ROASTER_REGISTRY["ikawa_pro"]
        pro_x = ROASTER_REGISTRY["ikawa_pro_x"]
        assert home["protocol"] == pro["protocol"] == pro_x["protocol"] == "ikawa_ble"
        assert home["default_params"]["temp_below"] == "exhaust"
        assert pro["default_params"]["temp_below"] == "inlet"
        assert pro_x["default_params"]["temp_below"] == "inlet"
        assert home["display_name"] == "IKAWA Home"
        assert pro["models"] == ["Pro"]
        assert pro_x["models"] == ["Pro X"]
        for entry in (home, pro, pro_x):
            assert entry["pid"] is None
            assert entry["capabilities"] == ["heater", "fan"]
            assert "write_map" not in entry["default_params"]
        assert "ikawa_ble" not in WRITABLE_PROTOCOLS

    async def test_manager_forwards_setpoint_only_when_present(self, manager):
        reading = make_reading()
        reading.setpoint = 190.0
        manager._adapter = FakeAdapter([reading])
        manager._connected = True
        assert (await manager.read_temperatures())["setpoint"] == 190.0

        manager._adapter = FakeAdapter([make_reading()])
        manager._last_good = None
        assert "setpoint" not in await manager.read_temperatures()

    def test_connection_error_formatter_keeps_the_official_app_hint(self):
        text = _format_connection_error(TimeoutError("timed out"), "ikawa_ble", {})
        assert "공식 앱" in text
        assert "timed out" not in text.lower()
        assert _format_connection_error(ModuleNotFoundError("No module named 'bleak'"), "ikawa_ble", {}) == (
            "bleak 라이브러리가 설치되지 않았습니다."
        )


def test_reading_setpoint_defaults_off():
    reading = Reading(bt=1, et=2, heater=None, fan=0, drum=0, timestamp=0)
    assert reading.setpoint is None

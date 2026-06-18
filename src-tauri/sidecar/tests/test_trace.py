"""protocol_trace 링버퍼 단위 테스트."""
from protocol_trace import ProtocolTrace


class TestProtocolTrace:
    def test_disabled_by_default_records_nothing(self):
        t = ProtocolTrace()
        t.record("rx", "s7", "db_read db=3 offset=116", b"\x42\x48\x00\x00")
        assert t.dump() == []

    def test_enabled_records_entry_with_hex_dump(self):
        t = ProtocolTrace()
        t.enabled = True
        t.record("rx", "s7", "db_read db=3 offset=116", b"\x42\x48\x00\x00")
        entries = t.dump()
        assert len(entries) == 1
        e = entries[0]
        assert e["dir"] == "rx"
        assert e["protocol"] == "s7"
        assert e["detail"] == "db_read db=3 offset=116"
        assert e["data"] == "42 48 00 00"  # bytes → hex 덤프
        assert isinstance(e["ts"], float)

    def test_non_bytes_data_passes_through(self):
        t = ProtocolTrace()
        t.enabled = True
        t.record("info", "modbus", "decoded", {"register": 100, "value": 215.5})
        assert t.dump()[0]["data"] == {"register": 100, "value": 215.5}

    def test_ring_buffer_caps_at_maxlen(self):
        t = ProtocolTrace(maxlen=3)
        t.enabled = True
        for i in range(5):
            t.record("info", "test", f"entry {i}")
        entries = t.dump()
        assert len(entries) == 3
        assert entries[0]["detail"] == "entry 2"  # 오래된 항목 탈락

    def test_clear_empties_buffer(self):
        t = ProtocolTrace()
        t.enabled = True
        t.record("info", "test", "x")
        t.clear()
        assert t.dump() == []

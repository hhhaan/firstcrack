"""Synthetic LevelDB fixtures only; V8 golden bytes serialized by Node v8.serialize."""
import json
import struct
import threading
from unittest.mock import patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

import firescope_import as importer
from firescope_import.indexeddb import decode, value
from firescope_import.leveldb import Corrupt, Unsupported, crc32c, read_snapshot, snappy
from main import create_app

UNICODE = bytes.fromhex("ff0f6f22046e616d6500630a5cb8a4c230d1200015262204756e69742202b0432207656e61626c65644622016e49007b04")
GRAPH = bytes.fromhex("ff0f6f220a79417869735374617274496422087941786973456e6449f40322087841786973456e6449a00b7b03")
MACHINE = bytes.fromhex("ff0f6f2202696422026d3122046e616d6522074d616368696e6522067072657365742206637573746f6d220f74656d7065726174757265556e69742202b043220a636f6e6e656374696f6e6f2206647269766572220c4d6f64627573447269766572220474797065220673657269616c220870726f746f636f6c22066d6f64627573220673657269616c6f2204747970652203525455220470617468220c2f6465762f6578616d706c652208626175645261746549809601220864617461426974734910220873746f70426974734904220670617269747922046e6f6e657b0622066d6f6462757341016f22056c6162656c2202425422076164647265737349d00f220873656e736f724964490222047265616422034643342204747970652207696e7465676572220c646563696d616c506c6163654902220c636f6d70656e736174696f6e49002204756e69742202b0437b08240001220870617373776f7264220668696464656e7b062205746f6b656e220668696464656e7b06")


def varint(number):
    result = bytearray()
    while number >= 128:
        result.append((number & 127) | 128)
        number >>= 7
    return bytes(result + bytes([number]))


def blob(data):
    return varint(len(data)) + data


def text16(text):
    encoded = text.encode("utf-16-be")
    return varint(len(encoded) // 2) + encoded


def envelope(v8):
    return b"\x01\xff\x15\xfe" + bytes(12) + v8


def masked(data):
    crc = crc32c(data)
    return ((crc >> 15 | crc << 17) + 0xa282ead8) & 0xffffffff


def log(payload):
    return struct.pack("<IHB", masked(b"\x01" + payload), len(payload), 1) + payload


def batch(sequence, rows):
    return log(struct.pack("<QI", sequence, len(rows)) + b"".join(bytes([int(data is not None)]) + blob(key) + (blob(data) if data is not None else b"") for key, data in rows))


def key(name, db=2, store=1):
    return bytes([0, db, store, 1, 1]) + text16(name)


DB_NAME = b"\0\0\0\0\xc9" + text16("file__0@1") + text16("ngStorage")
STORE_NAME = b"\0\x02\0\0\x32\x01\0"
GRAPH_KEY = key("bps.setting")
MACHINE_KEY = key("roasting-machine.RoastingMachineService")
META = [(b"\0\0\0\0\0", b"\x05"), (b"\0\0\0\0\x02", b"\x15\0\0\0\x0f"), (DB_NAME, b"\x02"), (STORE_NAME, "localStorage".encode("utf-16-be"))]


def snapshot(path, rows=()):
    path.mkdir(exist_ok=True, parents=True)
    (path / "CURRENT").write_bytes(b"MANIFEST-000001\n")
    (path / "MANIFEST-000001").write_bytes(log(b"\x01" + blob(b"idb_cmp1") + b"\x02\x02"))
    (path / "000002.log").write_bytes(batch(1, META) + batch(100, rows))
    (path / "LOCK").touch()
    return path


def test_v8_node_golden_unicode_and_zero():
    assert value(envelope(UNICODE)) == {"name": "로스터 ☕", "unit": "°C", "enabled": False, "n": 0}
    assert value(envelope(GRAPH)) == {"yAxisStart": 50, "yAxisEnd": 250, "xAxisEnd": 720}
    assert crc32c(b"123456789") == 0xe3069283


def test_latest_delete_history_and_secrets(tmp_path):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH)), (MACHINE_KEY, envelope(MACHINE)), (MACHINE_KEY, envelope(MACHINE)), (MACHINE_KEY, None), (key("auth"), b"undecodable secret")])
    result = importer.extract(tmp_path)
    assert result["graph"]["xAxisEnd"] == 720
    assert len(result["machines"]) == 1
    assert result["machines"][0]["sequence"] == 102
    assert result["machines"][0]["current"] is False
    assert result["graphTemperatureUnit"] is None
    assert "hidden" not in json.dumps(result)
    assert "password" not in json.dumps(result)
    sensor = result["machines"][0]["settings"]["connection"]["modbus"][0]
    assert sensor["address"] == 1000 and sensor["unit"] == "°C"


def test_current_machine_unit_and_demo_exclusion(tmp_path):
    snapshot(tmp_path, [(MACHINE_KEY, envelope(MACHINE))])
    result = importer.extract(tmp_path)
    assert result["machines"][0]["current"] is True
    assert result["graphTemperatureUnit"] == "°C"
    demo = value(envelope(MACHINE))
    demo["connection"]["driver"] = "DummyDriver"
    with patch("firescope_import.decode", return_value=({"machine": demo}, [(200, True, demo)])):
        result = importer.extract(tmp_path)
    assert result["machines"] == []
    assert result["graphTemperatureUnit"] == "°C"


@pytest.mark.parametrize("deleted", [DB_NAME, STORE_NAME, GRAPH_KEY])
def test_metadata_and_setting_tombstones(tmp_path, deleted):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH)), (deleted, None)])
    result = importer.extract(tmp_path)
    assert result["graph"] is None


def test_orphan_manifest_log_and_wrong_database_are_ignored(tmp_path):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH)), (key("bps.setting", db=9), b"bad")])
    (tmp_path / "MANIFEST-999999").write_bytes(b"bad")
    (tmp_path / "999999.ldb").write_bytes(b"bad")
    (tmp_path / "000001.log").write_bytes(b"bad")
    assert importer.extract(tmp_path)["graph"]["yAxisStart"] == 50


@pytest.mark.parametrize("payload", [b"bad", envelope(b"\xff\x10o{\0"), b"\x01\xff\x11\x01"])
def test_bad_latest_never_falls_back(tmp_path, payload):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH)), (GRAPH_KEY, payload)])
    with pytest.raises((Corrupt, Unsupported)):
        decode(tmp_path)


def test_latest_crc_and_truncation(tmp_path):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH))])
    file = tmp_path / "000002.log"
    original = file.read_bytes()
    file.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
    with pytest.raises(Corrupt, match="checksum"):
        read_snapshot(tmp_path)
    file.write_bytes(original[:-1])
    with pytest.raises(Corrupt):
        read_snapshot(tmp_path)


def test_wal_newer_than_manifest_log(tmp_path):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH))])
    (tmp_path / "000003.log").write_bytes(batch(200, [(GRAPH_KEY, None)]))
    assert importer.extract(tmp_path)["graph"] is None


def block(rows):
    data = b"".join(b"\0" + varint(len(k)) + varint(len(v)) + k + v for k, v in rows)
    return data + struct.pack("<II", 0, 1)


def sstable(rows):
    output = bytearray()
    def add(data):
        handle = varint(len(output)) + varint(len(data))
        output.extend(data + b"\0" + struct.pack("<I", masked(data + b"\0")))
        return handle
    payload = add(block([(key + struct.pack("<Q", seq << 8 | int(data is not None)), data or b"") for key, seq, data in rows]))
    meta = add(block([]))
    index = add(block([(b"last", payload)]))
    return bytes(output) + (meta + index).ljust(40, b"\0") + bytes.fromhex("57fb808b247547db")


def test_manifest_tables_compaction_wal_overwrite_and_crc(tmp_path):
    snapshot(tmp_path)
    data = sstable([(GRAPH_KEY, 50, envelope(GRAPH))])
    (tmp_path / "000003.ldb").write_bytes(data)
    manifest = tmp_path / "MANIFEST-000001"
    add = b"\x07\0\x03" + varint(len(data)) + blob(b"a") + blob(b"z")
    manifest.write_bytes(manifest.read_bytes() + log(add))
    assert importer.extract(tmp_path)["graph"]["yAxisEnd"] == 250
    (tmp_path / "000002.log").write_bytes(batch(1, META) + batch(100, [(GRAPH_KEY, None)]))
    assert importer.extract(tmp_path)["graph"] is None
    damaged = bytearray(data)
    damaged[5] ^= 1
    (tmp_path / "000003.ldb").write_bytes(damaged)
    with pytest.raises(Corrupt, match="checksum"):
        read_snapshot(tmp_path)
    manifest.write_bytes(manifest.read_bytes() + log(b"\x06\0\x03"))
    assert importer.extract(tmp_path)["graph"] is None


def test_snappy_literals_overlap_and_limits():
    assert snappy(b"\x06\x00a\x12\x01\x00") == b"aaaaaa"
    with pytest.raises(Corrupt):
        snappy(b"\x06\x12\x01\0")
    with pytest.raises(Unsupported):
        snappy(varint(33 * 1024 * 1024))


@pytest.fixture
def local_source(tmp_path, monkeypatch):
    monkeypatch.setattr(importer.sys, "platform", "darwin")
    monkeypatch.setattr(importer.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(importer, "running", lambda: False)
    return snapshot(tmp_path / "Library" / "Application Support" / "Firescope" / "IndexedDB" / "file__0.indexeddb.leveldb", [(GRAPH_KEY, envelope(GRAPH))])


def test_scan_reads_copy_and_preserves_original(local_source, monkeypatch):
    before = {p.name: p.read_bytes() for p in local_source.iterdir()}
    original = importer.extract
    def extract(path):
        assert path != local_source
        return original(path)
    monkeypatch.setattr(importer, "extract", extract)
    assert importer.scan()["status"] == "found"
    assert before == {p.name: p.read_bytes() for p in local_source.iterdir()}


def test_running_and_changed_copy_rejected(local_source, monkeypatch):
    monkeypatch.setattr(importer, "running", lambda: True)
    assert importer.scan()["status"] == "needs-app-closed"
    calls = iter([False, True])
    monkeypatch.setattr(importer, "running", lambda: next(calls))
    assert importer.scan()["reason"] == "database-changed"


def test_symlink_and_corrupt_scan_do_not_leak(local_source):
    (local_source / "evil").symlink_to(local_source / "CURRENT")
    assert importer.scan()["reason"] == "database-files"
    (local_source / "evil").unlink()
    (local_source / "CURRENT").write_bytes(b"private-secret")
    result = importer.scan()
    assert result["status"] == "unreadable"
    assert "private-secret" not in json.dumps(result)


async def test_endpoint_authenticated_and_threaded(monkeypatch):
    monkeypatch.setenv("SIDECAR_TOKEN", "example-token")
    main_thread = threading.get_ident()
    def scan():
        assert threading.get_ident() != main_thread
        return importer.response("not-found", "database-not-found")
    monkeypatch.setattr(importer, "scan", scan)
    async with TestClient(TestServer(create_app())) as client:
        assert (await client.get("/imports/firescope")).status == 401
        response = await client.get("/imports/firescope", headers={"X-Sidecar-Token": "example-token"})
        assert response.status == 200
        assert (await response.json())["status"] == "not-found"


def test_transport_selection_preserves_all_sensor_addresses(tmp_path):
    obj = value(envelope(MACHINE))
    obj["connection"]["ethernet"] = {"ip": "unselected-secret"}
    obj["connection"]["modbus"].append({"label": "power", "address": 200, "unit": "%", "compensation": 3, "token": "hidden"})
    clean = importer.machine(obj)
    assert "ethernet" not in clean["connection"]
    assert clean["connection"]["modbus"][1] == {"label": "power", "address": 200, "unit": "%", "compensation": 3}


def test_unknown_schema_is_explicit(tmp_path):
    snapshot(tmp_path, [(b"\0\0\0\0\0", b"\x06")])
    with pytest.raises(Unsupported, match="database-version"):
        importer.extract(tmp_path)


def test_scan_unknown_exception_never_escapes_with_private_context(local_source, monkeypatch):
    def fail(path):
        raise RuntimeError("private-secret")
    monkeypatch.setattr(importer, "extract", fail)
    assert importer.scan() == importer.response("unreadable", "database-unreadable")


def test_locked_database_is_rejected(local_source):
    import subprocess
    import sys
    # Independent process: POSIX locks belong to the process, not the descriptor.
    code = "import fcntl,sys; f=open(sys.argv[1],'r+'); fcntl.lockf(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()"
    process = subprocess.Popen([sys.executable, "-c", code, str(local_source / "LOCK")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "ready"
        assert importer.scan()["reason"] == "database-locked"
    finally:
        process.communicate("", timeout=5)


def test_source_lock_remains_held_during_decode(local_source, monkeypatch):
    import subprocess
    import sys
    def extract(path):
        code = "import fcntl,sys; f=open(sys.argv[1],'r+'); fcntl.lockf(f,fcntl.LOCK_EX|fcntl.LOCK_NB)"
        process = subprocess.run([sys.executable, "-c", code, str(local_source / "LOCK")], capture_output=True)
        assert process.returncode != 0
        return importer.response("found")
    monkeypatch.setattr(importer, "extract", extract)
    assert importer.scan()["status"] == "found"


def test_demo_filter_uses_driver_or_preset_not_name(tmp_path):
    real = value(envelope(MACHINE))
    real["name"] = "Test actual roaster"
    demo = value(envelope(MACHINE))
    demo["id"] = "demo"
    demo["preset"] = "test"
    with patch("firescope_import.decode", return_value=({"machine": demo}, [(100, False, real), (200, True, demo)])):
        result = importer.extract(tmp_path)
    assert [m["settings"]["id"] for m in result["machines"]] == ["m1"]


def test_file_change_during_copy_is_rejected(local_source, monkeypatch):
    original = importer.inventory
    calls = 0
    def inventory(path):
        nonlocal calls
        calls += 1
        if calls == 2:
            (local_source / "CURRENT").write_bytes(b"MANIFEST-000009\n")
        return original(path)
    monkeypatch.setattr(importer, "inventory", inventory)
    assert importer.scan()["reason"] == "database-changed"


# Chromium 128 ScopesPrefix=0000000032; metadata suffix=01, tasks suffix=02.
# Ref: components/services/storage/indexed_db/scopes/leveldb_scopes_coding.h
@pytest.mark.parametrize("suffix,payload", [
    (b"\x01\x07", b"\x0a\x00"),  # Pending scope with a lock; requires undo.
    (b"\x01\x07", b""),  # Committed scope still awaiting cleanup.
    (b"\x02\x07\x00" + bytes(8), b"\x12\x00"),  # Undo task without metadata.
    (b"\x02\x07\x01" + bytes(8), b"\x0a\x00"),  # Deferred range delete.
])
def test_pending_scope_work_rejected_before_returning_settings(tmp_path, suffix, payload):
    snapshot(tmp_path, [(GRAPH_KEY, envelope(GRAPH)), (b"\0\0\0\0\x32" + suffix, payload)])
    with pytest.raises(Unsupported, match="database-recovery-required"):
        importer.extract(tmp_path)


def test_cleaned_scope_tombstones_and_global_metadata_allowed(tmp_path):
    scope = b"\0\0\0\0\x32\x01\x07"
    task = b"\0\0\0\0\x32\x02\x07\0" + bytes(8)
    snapshot(tmp_path, [
        (b"\0\0\0\0\x32\0", b"\x08\x01"),
        (scope, b"\x0a\x00"), (task, b"\x12\x00"),
        (scope, None), (task, None), (GRAPH_KEY, envelope(GRAPH)),
    ])
    assert importer.extract(tmp_path)["graph"]["yAxisStart"] == 50


def test_unknown_scope_metadata_version_rejected(tmp_path):
    snapshot(tmp_path, [(b"\0\0\0\0\x32\0", b"\x08\x02")])
    with pytest.raises(Unsupported, match="scopes-version"):
        importer.extract(tmp_path)

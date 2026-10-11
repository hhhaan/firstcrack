import plistlib
import threading

from aiohttp.test_utils import TestClient, TestServer

import artisan_import as importer
from main import create_app


def native_plist(**updates):
    values = {
        "Mode": "C",
        "Device.id": 29,
        "ExtraDev.extradevices": [33],
        "Modbus.type": 0,
        "Modbus.input1register": 1000,
        "Modbus.input1Signed": False,
        "Modbus.input2div": 0,
        "Modbus.input8deviceId": 8,
        "S7.area": [0, 1],
        "Axis.xmin": 0,
        "Colors": {"bt": "#112233", "et": "#445566", "canvas": "private"},
        "BTfunction": "",
        "ChannelTares": [0, 1.5],
        "System.artisan_version": "4.8.0",
        "recentFileList": ["/private/roast.alog"],
        "RoastHubs.token": "secret",
    }
    values.update(updates)
    return plistlib.dumps(values, fmt=plistlib.FMT_BINARY)


def test_binary_plist_allowlist_values_version_and_missing():
    result = importer.extract(native_plist(**{"Modbus.input1float": b"QVariant"}))
    assert result["source"] == {"product": "Artisan", "version": "4.8.0", "sourceId": "native"}
    assert result["settings"]["Modbus/input1Signed"] is False
    assert result["settings"]["Modbus/input2div"] == 0
    assert result["settings"]["Modbus/input1float"] is None
    assert "Modbus/input8deviceId" not in result["settings"]
    assert "ETfunction" not in result["settings"]
    assert result["settings"]["Colors"] == {"bt": "#112233", "et": "#445566"}
    assert "recentFileList" not in result["settings"]
    assert "RoastHubs/token" not in result["settings"]


def test_version_is_not_inferred_from_other_keys():
    result = importer.extract(plistlib.dumps({"artisan_version": "9.0", "Mode": "C"}))
    assert result["source"]["version"] is None


def source_file(tmp_path, monkeypatch, data=None):
    monkeypatch.setattr(importer.sys, "platform", "darwin")
    monkeypatch.setattr(importer.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(importer, "running", lambda: False)
    path = tmp_path / "Library" / "Preferences" / "org.artisan-scope.Artisan.plist"
    path.parent.mkdir(parents=True)
    path.write_bytes(data or native_plist())
    return path


def test_scan_preserves_source(tmp_path, monkeypatch):
    path = source_file(tmp_path, monkeypatch)
    before = path.read_bytes()
    assert importer.scan()["status"] == "found"
    assert path.read_bytes() == before


def test_no_file_running_and_non_mac(tmp_path, monkeypatch):
    monkeypatch.setattr(importer.sys, "platform", "darwin")
    monkeypatch.setattr(importer.Path, "home", lambda: tmp_path)
    assert importer.scan()["status"] == "not-found"
    source_file(tmp_path, monkeypatch)
    monkeypatch.setattr(importer, "running", lambda: True)
    assert importer.scan() == importer.response("needs-app-closed", "app-running")
    monkeypatch.setattr(importer.sys, "platform", "linux")
    assert importer.scan() == importer.response("unsupported", "platform")


def test_malformed_oversize_and_symlink(tmp_path, monkeypatch):
    path = source_file(tmp_path, monkeypatch, b"not a plist")
    assert importer.scan()["status"] == "unreadable"
    path.write_bytes(b"x" * (importer.MAX_FILE_SIZE + 1))
    assert importer.scan() == importer.response("unsupported", "settings-file")
    path.unlink()
    target = tmp_path / "target.plist"
    target.write_bytes(native_plist())
    path.symlink_to(target)
    assert importer.scan() == importer.response("unsupported", "settings-file")


def test_change_during_read_is_rejected(tmp_path, monkeypatch):
    path = source_file(tmp_path, monkeypatch)
    original = importer.hashlib.sha256
    calls = 0

    def changed(data=b""):
        nonlocal calls
        calls += 1
        if calls == 2:
            path.write_bytes(native_plist(**{"Mode": "F"}))
        return original(data)

    monkeypatch.setattr(importer.hashlib, "sha256", changed)
    assert importer.scan() == importer.response("needs-app-closed", "settings-changed")


async def test_endpoint_authenticated_and_threaded(monkeypatch):
    monkeypatch.setenv("SIDECAR_TOKEN", "example-token")
    main_thread = threading.get_ident()

    def scan():
        assert threading.get_ident() != main_thread
        return importer.response("not-found", "settings-not-found")

    monkeypatch.setattr(importer, "scan", scan)
    async with TestClient(TestServer(create_app())) as client:
        assert (await client.get("/imports/artisan")).status == 401
        response = await client.get(
            "/imports/artisan", headers={"X-Sidecar-Token": "example-token"}
        )
        assert response.status == 200
        assert (await response.json())["status"] == "not-found"

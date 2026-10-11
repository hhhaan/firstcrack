import json
import threading

from aiohttp.test_utils import TestClient, TestServer
import pytest

import cropster_import as importer
from main import create_app


def documents(version="5.13"):
    machine = {
        "version": version,
        "selectedMachineId": "m1",
        "sources": {
            "GenericModbusRtuSourceFactory": {
                "serialPort": "/dev/cu.usbserial",
                "baudRate": "19200",
                "bigEndian": "false",
                "password": "secret",
            },
            "PrivateCloudSource": {"token": "secret"},
        },
        "channels": [
            {"name": "beanTemperature", "index": 0, "visibility": ["STATUS", "CHART"], "offset": 0, "primary": False, "secret": "x"},
            {"name": "privateChannel", "index": 9},
        ],
        "states": [{"control": "burner"}],
    }
    preferences = {
        "version": version,
        "temperatureUnit": "CELSIUS",
        "minTemp": 0,
        "autoDetectionEnabled": False,
        "username": "private@example.com",
    }
    return json.dumps(machine).encode(), json.dumps(preferences).encode()


def test_extract_filters_exact_schema_and_preserves_false_zero():
    machine, preferences = documents()
    result = importer.extract(machine, preferences)
    assert result["source"] == {"product": "Cropster", "version": "5.13", "sourceId": "default"}
    assert result["machine"] == {
        "version": "5.13",
        "selectedMachineId": "m1",
        "sources": {
            "GenericModbusRtuSourceFactory": {"serialPort": "/dev/cu.usbserial", "baudRate": "19200", "bigEndian": "false"},
            "PrivateCloudSource": {},
        },
        "channels": [
            {"name": "beanTemperature", "index": 0, "visibility": ["STATUS", "CHART"], "offset": 0, "primary": False},
            {"name": "privateChannel", "index": 9},
        ],
    }
    assert result["preferences"] == {
        "temperatureUnit": "CELSIUS", "minTemp": 0, "autoDetectionEnabled": False, "version": "5.13"
    }


def test_missing_files_and_versions_and_conflict():
    machine, preferences = documents()
    assert importer.extract(machine, None)["preferences"] is None
    assert importer.extract(None, preferences)["machine"] is None
    other_machine, _ = documents("5.12")
    assert importer.extract(other_machine, preferences) == importer.response(
        "unreadable", "settings-version-mismatch"
    )


def source_files(tmp_path, monkeypatch):
    monkeypatch.setattr(importer.sys, "platform", "darwin")
    monkeypatch.setattr(importer.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(importer, "running", lambda: False)
    directory = tmp_path / "CropsterRoastingIntelligence" / "default"
    directory.mkdir(parents=True)
    machine, preferences = documents()
    (directory / "machine.json").write_bytes(machine)
    (directory / "preferences.json").write_bytes(preferences)
    return directory


def test_scan_preserves_sources(tmp_path, monkeypatch):
    directory = source_files(tmp_path, monkeypatch)
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    assert importer.scan()["status"] == "found"
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == before


def test_no_file_app_running_and_non_mac(tmp_path, monkeypatch):
    monkeypatch.setattr(importer.sys, "platform", "darwin")
    monkeypatch.setattr(importer.Path, "home", lambda: tmp_path)
    assert importer.scan()["status"] == "not-found"
    source_files(tmp_path, monkeypatch)
    monkeypatch.setattr(importer, "running", lambda: True)
    assert importer.scan() == importer.response("needs-app-closed", "app-running")
    monkeypatch.setattr(importer.sys, "platform", "linux")
    assert importer.scan() == importer.response("unsupported", "platform")


def test_malformed_oversize_symlink_and_duplicate_key(tmp_path, monkeypatch):
    directory = source_files(tmp_path, monkeypatch)
    machine = directory / "machine.json"
    machine.write_text("not json")
    assert importer.scan()["status"] == "unreadable"
    machine.write_bytes(b"x" * (importer.MAX_FILE_SIZE + 1))
    assert importer.scan() == importer.response("unsupported", "settings-files")
    machine.unlink()
    target = tmp_path / "machine.json"
    target.write_text("{}")
    machine.symlink_to(target)
    assert importer.scan() == importer.response("unsupported", "settings-files")
    with pytest.raises(ValueError, match="duplicate-key"):
        importer.extract(b'{"version":"1","version":"2"}', None)


def test_change_during_read_is_rejected(tmp_path, monkeypatch):
    directory = source_files(tmp_path, monkeypatch)
    path = directory / "preferences.json"
    original = importer.hashlib.sha256
    calls = 0

    def changed(data=b""):
        nonlocal calls
        calls += 1
        if calls == 4:
            path.write_text('{}')
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
        assert (await client.get("/imports/cropster")).status == 401
        response = await client.get(
            "/imports/cropster", headers={"X-Sidecar-Token": "example-token"}
        )
        assert response.status == 200
        assert (await response.json())["status"] == "not-found"

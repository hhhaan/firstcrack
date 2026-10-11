"""Read Cropster RI's default local settings without launching RI."""

import hashlib
import json
import math
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading


MAX_FILE_SIZE = 4 * 1024 * 1024
_SCAN_LOCK = threading.Lock()
_FILES = ("machine.json", "preferences.json")
_PREFERENCE_KEYS = frozenset(
    {
        "temperatureUnit", "time", "minTemp", "maxTemp", "minRiseRate",
        "maxRiseRate", "ror", "rorSmoothing", "autoDetectionEnabled",
        "autoStartEnabled", "startThreshold", "endThreshold",
    }
)
_SOURCE_FIELDS = {
    "GenericModbusRtuSourceFactory": frozenset(
        {
            "temperatureUnit", "bigEndian", "storageFormatTemperature", "filter",
            "serialPort", "encoding", "baudRate", "dataBits", "parity", "stopBits",
            "modbusFunction", "beanTemperatureSlave", "beanTemperatureRegister",
            "exhaustTemperatureSlave", "exhaustTemperatureRegister",
        }
    ),
    "GenericModbusTcpSourceFactory": frozenset(
        {
            "temperatureUnit", "bigEndian", "storageFormatTemperature", "filter",
            "host", "port", "beanTemperatureRegister", "exhaustTemperatureRegister",
        }
    ),
}
_CHANNEL_FIELDS = frozenset(
    {"name", "sourceFactory", "index", "type", "visibility", "offset", "ror", "color", "primary"}
)
def response(status, reason=None, version=None, machine=None, preferences=None):
    result = {
        "status": status,
        "source": {"product": "Cropster", "version": version, "sourceId": "default"},
        "machine": machine,
        "preferences": preferences,
    }
    if reason:
        result["reason"] = reason
    return result


def _value(value):
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [_value(item) for item in value]
    return None


def _source_value(value):
    return value if value is None or isinstance(value, str) else None


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate-key")
        result[key] = value
    return result


def _json(data):
    value = json.loads(data, object_pairs_hook=_object)
    if not isinstance(value, dict):
        raise ValueError("settings-shape")
    return value


def _preferences(raw):
    result = {key: _value(raw[key]) for key in _PREFERENCE_KEYS if key in raw}
    if "version" in raw:
        result["version"] = _value(raw["version"])
    return result


def _machine(raw):
    result = {}
    if "version" in raw:
        result["version"] = _value(raw["version"])
    if "selectedMachineId" in raw:
        result["selectedMachineId"] = _value(raw["selectedMachineId"])

    if "sources" in raw:
        sources = raw["sources"]
        if not isinstance(sources, dict):
            result["sources"] = None
        else:
            result["sources"] = {}
            for name, source in sources.items():
                fields = _SOURCE_FIELDS.get(name)
                result["sources"][name] = (
                    {
                        key: _source_value(source[key])
                        for key in fields
                        if key in source
                    }
                    if fields is not None and isinstance(source, dict)
                    else {}
                )

    if "channels" in raw:
        channels = raw["channels"]
        if not isinstance(channels, list):
            result["channels"] = None
        else:
            result["channels"] = [
                {key: _value(channel[key]) for key in _CHANNEL_FIELDS if key in channel}
                for channel in channels
                if isinstance(channel, dict)
            ]
    return result


def extract(machine_data=None, preferences_data=None):
    machine_raw = _json(machine_data) if machine_data is not None else None
    preferences_raw = _json(preferences_data) if preferences_data is not None else None
    versions = {
        raw["version"]
        for raw in (machine_raw, preferences_raw)
        if raw is not None and isinstance(raw.get("version"), str)
    }
    if len(versions) > 1:
        return response("unreadable", "settings-version-mismatch")
    return response(
        "found",
        version=next(iter(versions), None),
        machine=_machine(machine_raw) if machine_raw is not None else None,
        preferences=_preferences(preferences_raw) if preferences_raw is not None else None,
    )


def running():
    for command in (
        ["/usr/bin/pgrep", "-x", "Cropster Roasting Intelligence|Roasting Intelligence|roastingintelligence|RoastingIntelligence"],
        ["/usr/bin/pgrep", "-f", "[o]rg.cropster.roastingintelligence.RoastingIntelligenceApp|[c]om.cropster.roastingintelligence.Launcher"],
    ):
        result = subprocess.run(command, capture_output=True, timeout=5, check=False)
        if result.returncode == 0:
            return True
        if result.returncode != 1:
            raise OSError("process-check")
    return False


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _read(path, before):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if _identity(opened) != _identity(before):
            raise InterruptedError
        data = handle.read(MAX_FILE_SIZE + 1)
        after = os.fstat(handle.fileno())
        handle.seek(0)
        digest = hashlib.sha256(handle.read(MAX_FILE_SIZE + 1)).digest()
    if len(data) > MAX_FILE_SIZE:
        raise OverflowError
    if _identity(after) != _identity(opened) or digest != hashlib.sha256(data).digest():
        raise InterruptedError
    return data


def scan():
    if sys.platform != "darwin":
        return response("unsupported", "platform")
    with _SCAN_LOCK:
        try:
            home = Path.home()
            directory = home / "CropsterRoastingIntelligence" / "default"
            for path in (directory, *directory.parents):
                if path == home:
                    break
                if path.is_symlink():
                    return response("unsupported", "settings-files")

            before = {}
            for name in _FILES:
                path = directory / name
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    before[name] = None
                    continue
                if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > MAX_FILE_SIZE:
                    return response("unsupported", "settings-files")
                before[name] = info
            if not any(before.values()):
                return response("not-found", "settings-not-found")
            if running():
                return response("needs-app-closed", "app-running")

            data = {
                name: _read(directory / name, info) if info is not None else None
                for name, info in before.items()
            }
            for name, info in before.items():
                path = directory / name
                try:
                    current = path.lstat()
                except FileNotFoundError:
                    current = None
                if (current is None) != (info is None) or (
                    current is not None and _identity(current) != _identity(info)
                ):
                    raise InterruptedError
            if running():
                raise InterruptedError
            return extract(data["machine.json"], data["preferences.json"])
        except InterruptedError:
            return response("needs-app-closed", "settings-changed")
        except OverflowError:
            return response("unsupported", "settings-files")
        except Exception:
            return response("unreadable", "settings-unreadable")


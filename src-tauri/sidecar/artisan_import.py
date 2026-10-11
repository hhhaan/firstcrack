"""Read the native macOS Artisan settings without launching Artisan."""

import hashlib
import math
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import sys
import threading


MAX_FILE_SIZE = 4 * 1024 * 1024
_SCAN_LOCK = threading.Lock()

_ROOT_KEYS = frozenset({"Mode", "BTfunction", "ETfunction", "ChannelTares"})
_GROUP_KEYS = {
    "Device": frozenset({"id"}),
    "ExtraDev": frozenset({"extradevices"}),
    "Modbus": frozenset(
        {
            "type", "comport", "baudrate", "bytesize", "parity", "stopbits",
            "host", "port", "wordorderLittle",
            *(
                f"input{channel}{field}"
                for channel in (1, 2)
                for field in (
                    "deviceId", "slave", "register", "float", "bcd", "code",
                    "div", "mode", "FloatsAsInt", "BCDsAsInt", "Signed",
                )
            ),
        }
    ),
    "S7": frozenset({"host", "port", "rack", "slot", "area", "db_nr", "start", "type", "mode", "div"}),
    "Axis": frozenset({"xmin", "xmax", "ymin", "ymax", "zmin", "zmax"}),
}
_COLOR_KEYS = frozenset({"bt", "et", "deltabt", "deltaet"})


def response(status, reason=None, version=None, settings=None):
    result = {
        "status": status,
        "source": {"product": "Artisan", "version": version, "sourceId": "native"},
        "settings": settings,
    }
    if reason:
        result["reason"] = reason
    return result


def _sanitize(value):
    if isinstance(value, bytes):
        return None
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    return None


def extract(data):
    raw = plistlib.loads(data)
    if not isinstance(raw, dict):
        raise ValueError("settings-shape")

    settings = {}
    for key in _ROOT_KEYS:
        if key in raw:
            settings[key] = _sanitize(raw[key])
    for group, keys in _GROUP_KEYS.items():
        for key in keys:
            native_key = f"{group}.{key}"
            if native_key in raw:
                settings[f"{group}/{key}"] = _sanitize(raw[native_key])
    if "Colors" in raw:
        colors = raw["Colors"]
        settings["Colors"] = (
            {key: _sanitize(colors[key]) for key in _COLOR_KEYS if key in colors}
            if isinstance(colors, dict)
            else None
        )

    version = raw.get("System.artisan_version")
    return response(
        "found",
        version=version if isinstance(version, str) else None,
        settings=settings,
    )


def running():
    result = subprocess.run(
        ["/usr/bin/pgrep", "-x", "Artisan"],
        capture_output=True,
        timeout=5,
        check=False,
    )
    if result.returncode not in (0, 1):
        raise OSError("process-check")
    return result.returncode == 0


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def scan():
    if sys.platform != "darwin":
        return response("unsupported", "platform")
    with _SCAN_LOCK:
        try:
            home = Path.home()
            source = home / "Library" / "Preferences" / "org.artisan-scope.Artisan.plist"
            try:
                source_info = source.lstat()
            except FileNotFoundError:
                return response("not-found", "settings-not-found")
            for path in (source, *source.parents):
                if path == home:
                    break
                if path.is_symlink():
                    return response("unsupported", "settings-file")
            if not stat.S_ISREG(source_info.st_mode) or source_info.st_size > MAX_FILE_SIZE:
                return response("unsupported", "settings-file")
            if running():
                return response("needs-app-closed", "app-running")

            descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as handle:
                opened = os.fstat(handle.fileno())
                if _identity(opened) != _identity(source_info):
                    return response("needs-app-closed", "settings-changed")
                data = handle.read(MAX_FILE_SIZE + 1)
                after_read = os.fstat(handle.fileno())
                handle.seek(0)
                digest = hashlib.sha256(handle.read(MAX_FILE_SIZE + 1)).digest()
            if len(data) > MAX_FILE_SIZE:
                return response("unsupported", "settings-file")
            if (
                _identity(after_read) != _identity(opened)
                or digest != hashlib.sha256(data).digest()
                or _identity(source.lstat()) != _identity(opened)
                or running()
            ):
                return response("needs-app-closed", "settings-changed")
            return extract(data)
        except (FileNotFoundError, PermissionError, OSError, plistlib.InvalidFileException, ValueError):
            return response("unreadable", "settings-unreadable")


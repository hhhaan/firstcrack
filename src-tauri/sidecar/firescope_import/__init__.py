"""Local Firescope settings import. No application launch or hardware access."""
import hashlib
import math
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading

from .indexeddb import decode
from .leveldb import Unsupported

GRAPH_FIELDS = frozenset("""
temperatureUnit xAxisStart xAxisEnd xAxisScaleUnit yAxisStart yAxisEnd
btLineColor etLineColor rorLineColor btRorLineColor etRorLineColor
btLineWidth etLineWidth rorLineWidth btRorLineWidth etRorLineWidth
rorYAxisStart rorYAxisEnd rorInterval dryingEndTemp crackStartTemp
xAxisAutoExtend y2AxisStart y2AxisEnd etLineVisible btRorLineVisible etRorLineVisible
indicatorRorUnit checkDryingEndEvent checkFirstCrackEvent checkChargeTempDescending
chargeTempGap checkDropTempDescending dropTempGap
""".split())
INDICATOR_FIELDS = frozenset({"developmentTimeVisible", "rorInterval", "etBtSwapped"})
MACHINE_FIELDS = frozenset({"id", "name", "preset", "capacity", "temperatureUnit"})
TRANSPORT_FIELDS = frozenset({"type", "path", "baudRate", "dataBits", "stopBits", "parity", "ip", "host", "port"})
SENSOR_FIELDS = frozenset({"label", "length", "type", "address", "start", "read", "sensorId", "decimalPlace", "unit", "compensation", "hubId", "thermocoupleType", "rtdType", "rtdWire", "wordOrder", "byteOrder", "enabled", "name"})

_SCAN_LOCK = threading.Lock()


def fields(obj, allowed):
    if not isinstance(obj, dict):
        raise Unsupported("settings-shape")
    result = {}
    for key in allowed & obj.keys():
        item = obj[key]
        if item is None or isinstance(item, (bool, str, int, float)):
            if isinstance(item, str) and (len(item) > 1024 or any(0xd800 <= ord(c) <= 0xdfff for c in item)):
                raise Unsupported("settings-value")
            if isinstance(item, (int, float)) and not isinstance(item, bool) and not math.isfinite(item):
                raise Unsupported("settings-value")
            result[key] = item
        else:
            raise Unsupported("settings-shape")
    return result


def machine(obj):
    result = fields(obj, MACHINE_FIELDS)
    connection = obj.get("connection")
    if not isinstance(connection, dict):
        raise Unsupported("machine-connection")
    result["connection"] = selected = fields(connection, {"driver", "type", "protocol", "slot"})
    transport, protocol = connection.get("type"), connection.get("protocol")
    if transport in {"serial", "ethernet", "managed", "usb"} and transport in connection:
        selected[transport] = fields(connection[transport], TRANSPORT_FIELDS)
    if protocol in {"modbus", "s7", "phidget", "websocket", "usb"} and protocol in connection:
        sensors = connection[protocol]
        if not isinstance(sensors, list) or len(sensors) > 128:
            raise Unsupported("sensor-shape")
        selected[protocol] = [fields(sensor, SENSOR_FIELDS) for sensor in sensors]
    return result


def response(status, reason=None):
    result = {"status": status, "source": {"product": "Firescope", "version": None}, "graph": None, "graphTemperatureUnit": None, "indicator": None, "global": None, "machines": []}
    if reason:
        result["reason"] = reason
    return result


def extract(path):
    settings, history = decode(path)
    result = response("found")
    for key, allowed in (("graph", GRAPH_FIELDS), ("indicator", INDICATOR_FIELDS), ("global", {"temperature"})):
        if settings.get(key) is not None:
            result[key] = fields(settings[key], allowed)
    if settings.get("graph") is not None and "event" in settings["graph"]:
        result["graph"]["event"] = fields(settings["graph"]["event"], {"airSpeedEventName", "fireEventName", "isExtraLabelVisible", "temperatureType"})
    current_machine = settings.get("machine")
    if isinstance(current_machine, dict):
        unit = fields(current_machine, {"temperatureUnit"}).get("temperatureUnit")
        if isinstance(unit, str):
            result["graphTemperatureUnit"] = unit
    grouped = {}
    for sequence, current, obj in history:
        if obj.get("preset") == "test" or (isinstance(obj.get("connection"), dict) and obj["connection"].get("driver") == "DummyDriver"):
            continue
        clean = machine(obj)
        identity = clean.get("id")
        if identity is None or isinstance(identity, bool) or not isinstance(identity, (str, int)):
            raise Unsupported("machine-identity")
        identity = (type(identity).__name__, identity)
        if identity not in grouped or grouped[identity]["sequence"] < sequence:
            grouped[identity] = {"sequence": sequence, "current": current, "settings": clean}
    result["machines"] = sorted(grouped.values(), key=lambda item: item["sequence"], reverse=True)
    if not settings and not history:
        return response("not-found", "settings-not-found")
    return result


def running():
    result = subprocess.run(["/usr/bin/pgrep", "-x", "Firescope|Firescope Helper.*"], capture_output=True, timeout=5, check=False)
    if result.returncode not in (0, 1):
        raise OSError("process-check")
    return result.returncode == 0


def inventory(path):
    files = {}
    total = 0
    for file in path.iterdir():
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise Unsupported("database-files")
        total += info.st_size
        if len(files) >= 512 or total > 128 * 1024 * 1024 or info.st_size > 32 * 1024 * 1024:
            raise Unsupported("size-limit")
        files[file.name] = (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return files


def scan():
    if sys.platform != "darwin":
        return response("unsupported", "platform")
    with _SCAN_LOCK:
        try:
            import fcntl
            home = Path.home()
            source = home / "Library" / "Application Support" / "Firescope" / "IndexedDB" / "file__0.indexeddb.leveldb"
            if not source.exists():
                return response("not-found", "database-not-found")
            if any(path.is_symlink() for path in (source, *source.parents) if path != home and home in path.parents):
                raise Unsupported("database-files")
            if running():
                return response("needs-app-closed", "app-running")
            # A shared POSIX lock conflicts with Chromium's exclusive LevelDB lock.
            # O_NOFOLLOW prevents a raced symlink from redirecting the source lock.
            descriptor = os.open(source / "LOCK", os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as lock:
                try:
                    fcntl.lockf(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                except BlockingIOError:
                    return response("needs-app-closed", "database-locked")
                before = inventory(source)
                with tempfile.TemporaryDirectory(prefix="fc-firescope-") as directory:
                    target = Path(directory)
                    hashes = {}
                    for name in before:
                        if name == "LOCK":
                            continue
                        fd = os.open(source / name, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, "rb") as handle:
                            data = handle.read(32 * 1024 * 1024 + 1)
                        if len(data) != before[name][1]:
                            return response("needs-app-closed", "database-changed")
                        hashes[name] = hashlib.sha256(data).digest()
                        (target / name).write_bytes(data)
                    if running() or inventory(source) != before:
                        return response("needs-app-closed", "database-changed")
                    for name, digest in hashes.items():
                        fd = os.open(source / name, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, "rb") as handle:
                            if hashlib.sha256(handle.read(32 * 1024 * 1024 + 1)).digest() != digest:
                                return response("needs-app-closed", "database-changed")
                    if inventory(source) != before or running():
                        return response("needs-app-closed", "database-changed")
                    return extract(target)
        except Unsupported as exc:
            return response("unsupported", str(exc))
        except Exception:
            # Do not send paths, raw records or exception messages to logs/telemetry.
            return response("unreadable", "database-unreadable")

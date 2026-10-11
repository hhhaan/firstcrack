"""Decode only ngStorage/localStorage settings, with latest metadata and tombstones."""
import math
import struct

from .leveldb import Corrupt, Reader, Unsupported, read_snapshot

KEYS = {
    "bps.setting": "graph",
    "setting.IndicatorSettingService": "indicator",
    "setting.GlobalSettingService": "global",
    "roasting-machine.RoastingMachineService": "machine",
}


def prefix(key):
    r = Reader(key)
    sizes = r.integer(1)
    ids = (r.integer((sizes >> 5) + 1), r.integer(((sizes >> 2) & 7) + 1), r.integer((sizes & 3) + 1))
    return ids, r


def string16(r):
    return r.take(r.varint() * 2).decode("utf-16-be")


def value(data):
    r = Reader(data)
    r.varint()  # IndexedDB record version, not the serialization version.
    if r.integer(1) != 255:
        raise Unsupported("blink-format")
    blink = r.varint()
    if not 16 <= blink <= 21:
        raise Unsupported("blink-version")
    if blink >= 21:
        if r.integer(1) != 254:
            raise Corrupt("blink-trailer")
        offset = int.from_bytes(r.take(8), "big")
        size = int.from_bytes(r.take(4), "big")
        if offset or size:
            raise Unsupported("blink-trailer")
    if r.integer(1) != 255 or r.varint() != 15:
        raise Unsupported("v8-version")
    nodes = 0
    undefined = object()
    objects = []
    active = set()

    def peek():
        while r.pos < len(r.data) and r.data[r.pos] == 0:
            r.pos += 1
        if r.pos == len(r.data):
            raise Corrupt("truncated-v8")
        return r.data[r.pos]

    def read(depth=0):
        nonlocal nodes
        nodes += 1
        if depth > 32 or nodes > 20000:
            raise Unsupported("value-limit")
        tag = peek()
        r.pos += 1
        if tag == ord('_'):
            return undefined
        if tag in (ord('0'), ord('T'), ord('F')):
            return {ord('0'): None, ord('T'): True, ord('F'): False}[tag]
        if tag in (ord('I'), ord('U')):
            number = r.varint()
            if number > 0xffffffff:
                raise Corrupt("invalid-v8-integer")
            return (number >> 1) ^ -(number & 1) if tag == ord('I') else number
        if tag == ord('N'):
            number = struct.unpack("<d", r.take(8))[0]
            if not math.isfinite(number):
                raise Unsupported("non-finite-value")
            return number
        if tag in (ord('S'), ord('"'), ord('c')):
            return r.blob().decode({ord('S'): "utf-8", ord('"'): "latin-1", ord('c'): "utf-16-le"}[tag])
        if tag == ord('^'):
            index = r.varint()
            if index >= len(objects) or index in active:
                raise Unsupported("cyclic-reference")
            return objects[index]
        if tag == ord('o'):
            obj = {}
            index = len(objects)
            objects.append(obj)
            active.add(index)
            count = 0
            seen = set()
            while peek() != ord('{'):
                key = read(depth + 1)
                if not isinstance(key, str) or key in seen:
                    raise Unsupported("object-key")
                seen.add(key)
                item = read(depth + 1)
                count += 1
                if item is not undefined:
                    obj[key] = item
            r.pos += 1
            if r.varint() != count:
                raise Corrupt("object-size")
            active.remove(index)
            return obj
        if tag == ord('a'):
            length = r.varint()
            if length > 10000:
                raise Unsupported("value-limit")
            array = [None] * length
            index = len(objects)
            objects.append(array)
            active.add(index)
            count = 0
            while peek() != ord('@'):
                key = read(depth + 1)
                if isinstance(key, str) and key.isdecimal():
                    key = int(key)
                if type(key) is not int or not 0 <= key < length:
                    raise Unsupported("array-properties")
                item = read(depth + 1)
                array[key] = None if item is undefined else item
                count += 1
            r.pos += 1
            if r.varint() != count or r.varint() != length:
                raise Corrupt("array-size")
            active.remove(index)
            return array
        if tag == ord('A'):
            length = r.varint()
            if length > 10000:
                raise Unsupported("value-limit")
            array = []
            index = len(objects)
            objects.append(array)
            active.add(index)
            array.extend(read(depth + 1) for _ in range(length))
            if peek() != ord('$'):
                raise Unsupported("array-properties")
            r.pos += 1
            if r.varint() != 0 or r.varint() != length:
                raise Corrupt("array-size")
            active.remove(index)
            if any(item is undefined for item in array):
                raise Unsupported("array-undefined")
            return array
        # Host objects and external blobs are rejected, never coerced.
        raise Unsupported("v8-value-type")

    result = read()
    r.done()
    if not isinstance(result, dict):
        raise Unsupported("settings-shape")
    return result


def decode(path):
    records = read_snapshot(path)
    latest = {}
    for key, sequence, data in records:
        previous = latest.get(key)
        if previous is not None and previous[0] == sequence and previous[1] != data:
            raise Corrupt("conflicting-record")
        if previous is None or previous[0] < sequence:
            latest[key] = (sequence, data)
    # Chromium ScopesPrefix + scope/task entries require recovery or cleanup,
    # even with the app closed; only the version-1 global metadata is inert.
    scopes_prefix = b"\x00\x00\x00\x00\x32"
    for key, (_, data) in latest.items():
        if data is None or not key.startswith(scopes_prefix):
            continue
        if key == scopes_prefix + b"\x00":
            if data != b"\x08\x01":
                raise Unsupported("scopes-version")
        else:
            raise Unsupported("database-recovery-required")
    schema = latest.get(b"\x00\x00\x00\x00\x00")
    encoding = latest.get(b"\x00\x00\x00\x00\x02")
    if schema is None or schema[1] != b"\x05" or encoding is None or encoding[1] != b"\x15\x00\x00\x00\x0f":
        raise Unsupported("database-version")
    databases = []
    for key, (sequence, data) in latest.items():
        if key.startswith(b"\x00\x00\x00\x00\xc9") and data is not None:
            r = Reader(key[5:])
            origin, name = string16(r), string16(r)
            r.done()
            if origin in {"file__0", "file__0@1"} and name == "ngStorage":
                databases.append(int.from_bytes(data, "little"))
    if not databases:
        return {}, []
    if len(databases) != 1:
        raise Unsupported("ambiguous-database")
    database = databases[0]
    stores = []
    for key, (_, data) in latest.items():
        ids, r = prefix(key)
        if ids == (database, 0, 0) and r.pos < len(key) and r.integer(1) == 50:
            store, kind = r.varint(), r.integer(1)
            r.done()
            if kind == 0 and data is not None and data.decode("utf-16-be") == "localStorage":
                stores.append(store)
    if not stores:
        return {}, []
    if len(stores) != 1:
        raise Unsupported("ambiguous-store")
    settings, history = {}, []
    for key, sequence, data in records:
        ids, r = prefix(key)
        if ids != (database, stores[0], 1) or r.integer(1) != 1:
            continue
        name = string16(r)
        r.done()
        if name not in KEYS:
            continue
        current = latest[key][0] == sequence
        if data is None:
            if current:
                settings[KEYS[name]] = None
            continue
        if current or name == "roasting-machine.RoastingMachineService":
            decoded = value(data)
            if current:
                settings[KEYS[name]] = decoded
            if name == "roasting-machine.RoastingMachineService":
                history.append((sequence, current, decoded))
    return settings, history

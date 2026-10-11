"""Bounded read-only LevelDB snapshot decoder; never opens a database engine."""
import re
from pathlib import Path

LIMIT = 32 * 1024 * 1024


class Unsupported(ValueError):
    pass


class Corrupt(ValueError):
    pass


class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def take(self, size):
        if size < 0 or size > LIMIT or self.pos + size > len(self.data):
            raise Corrupt("truncated-data")
        value = self.data[self.pos:self.pos + size]
        self.pos += size
        return value

    def integer(self, size):
        return int.from_bytes(self.take(size), "little")

    def varint(self):
        value = 0
        for shift in range(0, 70, 7):
            byte = self.integer(1)
            value |= (byte & 127) << shift
            if not byte & 128:
                if value > (1 << 64) - 1:
                    break
                return value
        raise Corrupt("invalid-varint")

    def blob(self):
        return self.take(self.varint())

    def done(self):
        if self.pos != len(self.data):
            raise Corrupt("trailing-data")


def _crc_table():
    result = []
    for byte in range(256):
        crc = byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82f63b78 if crc & 1 else 0)
        result.append(crc)
    return tuple(result)


_CRC_TABLE = _crc_table()


def crc32c(data):
    crc = 0xffffffff
    for byte in data:
        crc = _CRC_TABLE[(crc ^ byte) & 255] ^ (crc >> 8)
    return crc ^ 0xffffffff


def checksum(data, expected):
    crc = crc32c(data)
    if (((crc >> 15) | (crc << 17)) + 0xa282ead8) & 0xffffffff != expected:
        raise Corrupt("checksum-mismatch")


def log_records(data):
    pending = None
    for start in range(0, len(data), 32768):
        r = Reader(data[start:start + 32768])
        while r.pos < len(r.data):
            if len(r.data) - r.pos < 7:
                if any(r.take(len(r.data) - r.pos)):
                    raise Corrupt("truncated-log")
                break
            crc, size, kind = r.integer(4), r.integer(2), r.integer(1)
            if kind == 0 and size == 0 and crc == 0:
                if any(r.take(len(r.data) - r.pos)):
                    raise Corrupt("invalid-log-padding")
                break
            value = r.take(size)
            checksum(bytes([kind]) + value, crc)
            if kind == 1 and pending is None:
                yield value
            elif kind == 2 and pending is None:
                pending = bytearray(value)
            elif kind in (3, 4) and pending is not None:
                pending.extend(value)
                if len(pending) > LIMIT:
                    raise Unsupported("size-limit")
                if kind == 4:
                    yield bytes(pending)
                    pending = None
            else:
                raise Corrupt("invalid-log-fragment")
    if pending is not None:
        raise Corrupt("truncated-log")


def snappy(data):
    r = Reader(data)
    size = r.varint()
    if size > LIMIT:
        raise Unsupported("size-limit")
    out = bytearray()
    while r.pos < len(data):
        tag = r.integer(1)
        kind = tag & 3
        if kind == 0:
            length = tag >> 2
            length = length + 1 if length < 60 else r.integer(length - 59) + 1
            if len(out) + length > size:
                raise Corrupt("invalid-snappy-length")
            out.extend(r.take(length))
        else:
            if kind == 1:
                length, offset = 4 + ((tag >> 2) & 7), ((tag & 224) << 3) | r.integer(1)
            else:
                length, offset = 1 + (tag >> 2), r.integer(2 if kind == 2 else 4)
            if not 0 < offset <= len(out) or len(out) + length > size:
                raise Corrupt("invalid-snappy-copy")
            for _ in range(length):
                out.append(out[-offset])
    if len(out) != size:
        raise Corrupt("invalid-snappy-length")
    return bytes(out)


def entries(data):
    if len(data) < 4:
        raise Corrupt("invalid-block")
    count = int.from_bytes(data[-4:], "little")
    end = len(data) - 4 * (count + 1)
    if count == 0 or end < 0:
        raise Corrupt("invalid-restarts")
    offsets = [int.from_bytes(data[end + i * 4:end + i * 4 + 4], "little") for i in range(count)]
    if offsets[0] != 0 or offsets != sorted(set(offsets)) or offsets[-1] > end:
        raise Corrupt("invalid-restarts")
    r, previous, starts = Reader(data[:end]), b"", set()
    while r.pos < end:
        start = r.pos
        starts.add(start)
        shared, unshared, size = r.varint(), r.varint(), r.varint()
        if shared > len(previous) or (start in offsets and shared):
            raise Corrupt("invalid-shared-key")
        previous = previous[:shared] + r.take(unshared)
        yield previous, r.take(size)
    if end and not set(offsets).issubset(starts):
        raise Corrupt("invalid-restarts")


def table(data):
    if len(data) < 48 or data[-8:] != bytes.fromhex("57fb808b247547db"):
        raise Corrupt("invalid-table-footer")
    footer = Reader(data[-48:-8])
    meta = (footer.varint(), footer.varint())
    index = (footer.varint(), footer.varint())

    def block(handle):
        offset, size = handle
        if offset + size + 5 > len(data) - 48:
            raise Corrupt("invalid-block-handle")
        value = data[offset:offset + size]
        kind = data[offset + size]
        checksum(value + bytes([kind]), int.from_bytes(data[offset + size + 1:offset + size + 5], "little"))
        if kind not in (0, 1):
            raise Unsupported("table-compression")
        return snappy(value) if kind else value

    # Validate ancillary blocks too, although their contents cannot change settings.
    for _, handle in entries(block(meta)):
        r = Reader(handle)
        block((r.varint(), r.varint()))
        r.done()
    for _, handle in entries(block(index)):
        r = Reader(handle)
        payload = block((r.varint(), r.varint()))
        r.done()
        for key, value in entries(payload):
            if len(key) < 8:
                raise Corrupt("invalid-internal-key")
            trailer = int.from_bytes(key[-8:], "little")
            kind = trailer & 255
            if kind not in (0, 1):
                raise Unsupported("record-type")
            yield key[:-8], trailer >> 8, value if kind else None


def read_snapshot(path: Path):
    current = (path / "CURRENT").read_bytes()
    if not re.fullmatch(rb"MANIFEST-[0-9]+\n", current):
        raise Corrupt("invalid-current")
    tables, log, previous_log, comparator = {}, None, 0, None
    for payload in log_records((path / current.decode().strip()).read_bytes()):
        r = Reader(payload)
        while r.pos < len(payload):
            tag = r.varint()
            if tag == 1:
                comparator = r.blob()
            elif tag in (2, 3, 4, 9):
                value = r.varint()
                if tag == 2:
                    log = value
                elif tag == 9:
                    previous_log = value
            elif tag == 5:
                r.varint()
                r.blob()
            elif tag == 6:
                r.varint()
                tables.pop(r.varint(), None)
            elif tag == 7:
                r.varint()
                number, size = r.varint(), r.varint()
                r.blob()
                r.blob()
                tables[number] = size
            else:
                raise Unsupported("manifest-tag")
    if comparator != b"idb_cmp1" or log is None:
        raise Unsupported("database-format")
    records = []
    record_bytes = 0

    def append(record):
        nonlocal record_bytes
        record_bytes += len(record[0]) + len(record[2] or b"")
        if len(records) >= 100000 or record_bytes > 128 * 1024 * 1024:
            raise Unsupported("record-limit")
        records.append(record)

    for number, size in tables.items():
        options = [p for p in (path / f"{number:06d}.ldb", path / f"{number:06d}.sst") if p.exists()]
        if len(options) != 1 or options[0].stat().st_size != size:
            raise Corrupt("missing-table")
        for record in table(options[0].read_bytes()):
            append(record)
    if log and not (path / f"{log:06d}.log").is_file():
        raise Corrupt("missing-log")
    for file in sorted(path.glob("*.log")):
        if not file.stem.isdecimal():
            continue
        number = int(file.stem)
        if number < log and number != previous_log:
            continue
        for payload in log_records(file.read_bytes()):
            r = Reader(payload)
            sequence, count = r.integer(8), r.integer(4)
            if count > 1000000 or sequence + count > 1 << 56:
                raise Unsupported("record-limit")
            for i in range(count):
                kind, key = r.integer(1), r.blob()
                if kind not in (0, 1):
                    raise Unsupported("record-type")
                append((key, sequence + i, r.blob() if kind else None))
            r.done()
    return records

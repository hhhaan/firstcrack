use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
};

use serde_json::{json, Map, Value};

use super::ImportError;

const LIMIT: usize = 32 * 1024 * 1024;
type Result<T> = std::result::Result<T, ImportError>;
type Record = (Vec<u8>, u64, Option<Vec<u8>>);
type Decoded = (
    HashMap<&'static str, Option<Value>>,
    Vec<(u64, bool, Value)>,
);

fn corrupt(reason: &'static str) -> ImportError {
    ImportError::Corrupt(reason)
}
fn unsupported(reason: &'static str) -> ImportError {
    ImportError::Unsupported(reason)
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}
impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > LIMIT
            || self
                .pos
                .checked_add(n)
                .is_none_or(|end| end > self.data.len())
        {
            return Err(corrupt("truncated-data"));
        }
        let value = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(value)
    }
    fn int(&mut self, n: usize) -> Result<u64> {
        Ok(self
            .take(n)?
            .iter()
            .enumerate()
            .fold(0, |v, (i, b)| v | (*b as u64) << (8 * i)))
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0u64;
        for shift in (0..70).step_by(7) {
            let byte = self.int(1)?;
            if shift == 63 && byte > 1 {
                break;
            }
            value |= (byte & 127) << shift;
            if byte & 128 == 0 {
                return Ok(value);
            }
        }
        Err(corrupt("invalid-varint"))
    }
    fn blob(&mut self) -> Result<&'a [u8]> {
        let n = self.varint()?;
        self.take(usize::try_from(n).map_err(|_| corrupt("truncated-data"))?)
    }
    fn done(&self) -> Result<()> {
        if self.pos == self.data.len() {
            Ok(())
        } else {
            Err(corrupt("trailing-data"))
        }
    }

    #[cfg(any())]
    fn scanner_source(home: &Path) -> std::path::PathBuf {
        let source =
            home.join("Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb");
        fs::create_dir_all(&source).unwrap();
        let fixture = snapshot(&[(graph_key(), Some(envelope(&hex(GRAPH))))]);
        for entry in fs::read_dir(fixture.path()).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), source.join(entry.file_name())).unwrap();
        }
        source
    }

    #[cfg(any())]
    fn scanner_preserves_source_and_rejects_symlinks_and_size_limits() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let source = scanner_source(home.path());
        let contents = |path: &Path| -> BTreeMap<_, _> {
            fs::read_dir(path)
                .unwrap()
                .map(|e| {
                    let e = e.unwrap();
                    (e.file_name(), fs::read(e.path()).unwrap())
                })
                .collect()
        };
        let before = contents(&source);
        assert_eq!(scan(home.path())["status"], "found");
        assert_eq!(contents(&source), before);

        let linked_home = tempfile::tempdir().unwrap();
        let parent = linked_home
            .path()
            .join("Library/Application Support/Firescope/IndexedDB");
        fs::create_dir_all(&parent).unwrap();
        symlink(&source, parent.join("file__0.indexeddb.leveldb")).unwrap();
        assert_eq!(scan(linked_home.path())["reason"], "database-files");

        let oversized_home = tempfile::tempdir().unwrap();
        let oversized = scanner_source(oversized_home.path());
        fs::File::create(oversized.join("oversized"))
            .unwrap()
            .set_len(LIMIT as u64 + 1)
            .unwrap();
        assert_eq!(scan(oversized_home.path())["reason"], "size-limit");

        let total_home = tempfile::tempdir().unwrap();
        let total = scanner_source(total_home.path());
        for n in 0..5 {
            fs::File::create(total.join(format!("large-{n}")))
                .unwrap()
                .set_len(27 * 1024 * 1024)
                .unwrap();
        }
        assert_eq!(scan(total_home.path())["reason"], "size-limit");
    }
}

fn crc32c(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (if crc & 1 != 0 { 0x82f63b78 } else { 0 });
        }
    }
    !crc
}
fn checksum(kind: u8, value: &[u8], expected: u32) -> Result<()> {
    let mut bytes = Vec::with_capacity(value.len() + 1);
    bytes.push(kind);
    bytes.extend(value);
    let crc = crc32c(&bytes);
    let masked = crc.rotate_right(15).wrapping_add(0xa282ead8);
    if masked == expected {
        Ok(())
    } else {
        Err(corrupt("checksum-mismatch"))
    }
}
fn table_checksum(value: &[u8], kind: u8, expected: u32) -> Result<()> {
    let mut bytes = Vec::with_capacity(value.len() + 1);
    bytes.extend(value);
    bytes.push(kind);
    let crc = crc32c(&bytes);
    if crc.rotate_right(15).wrapping_add(0xa282ead8) == expected {
        Ok(())
    } else {
        Err(corrupt("checksum-mismatch"))
    }
}
fn log_records(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    let mut out = vec![];
    let mut pending: Option<Vec<u8>> = None;
    for block in data.chunks(32768) {
        let mut r = Reader::new(block);
        while r.pos < block.len() {
            if block.len() - r.pos < 7 {
                if r.take(block.len() - r.pos)?.iter().any(|b| *b != 0) {
                    return Err(corrupt("truncated-log"));
                }
                break;
            }
            let crc = r.int(4)? as u32;
            let size = r.int(2)? as usize;
            let kind = r.int(1)? as u8;
            if (crc, size, kind) == (0, 0, 0) {
                if r.take(block.len() - r.pos)?.iter().any(|b| *b != 0) {
                    return Err(corrupt("invalid-log-padding"));
                }
                break;
            }
            let value = r.take(size)?;
            checksum(kind, value, crc)?;
            match (kind, pending.as_mut()) {
                (1, None) => out.push(value.to_vec()),
                (2, None) => pending = Some(value.to_vec()),
                (3 | 4, Some(p)) => {
                    p.extend(value);
                    if p.len() > LIMIT {
                        return Err(unsupported("size-limit"));
                    }
                    if kind == 4 {
                        out.push(pending.take().unwrap());
                    }
                }
                _ => return Err(corrupt("invalid-log-fragment")),
            }
        }
    }
    if pending.is_some() {
        Err(corrupt("truncated-log"))
    } else {
        Ok(out)
    }
}
fn snappy(data: &[u8]) -> Result<Vec<u8>> {
    let mut r = Reader::new(data);
    let size = usize::try_from(r.varint()?).map_err(|_| unsupported("size-limit"))?;
    if size > LIMIT {
        return Err(unsupported("size-limit"));
    }
    let mut out = Vec::with_capacity(size);
    while r.pos < data.len() {
        let tag = r.int(1)? as u8;
        let kind = tag & 3;
        if kind == 0 {
            let x = tag >> 2;
            let n = if x < 60 {
                x as usize + 1
            } else {
                r.int((x - 59) as usize)? as usize + 1
            };
            if out.len().checked_add(n).is_none_or(|x| x > size) {
                return Err(corrupt("invalid-snappy-length"));
            }
            out.extend(r.take(n)?);
        } else {
            let (n, off) = if kind == 1 {
                (
                    4 + ((tag >> 2) & 7) as usize,
                    (((tag & 224) as usize) << 3) | r.int(1)? as usize,
                )
            } else {
                (
                    1 + (tag >> 2) as usize,
                    r.int(if kind == 2 { 2 } else { 4 })? as usize,
                )
            };
            if off == 0 || off > out.len() || out.len().checked_add(n).is_none_or(|x| x > size) {
                return Err(corrupt("invalid-snappy-copy"));
            }
            for _ in 0..n {
                out.push(out[out.len() - off]);
            }
        }
    }
    if out.len() != size {
        Err(corrupt("invalid-snappy-length"))
    } else {
        Ok(out)
    }
}
fn entries(data: &[u8]) -> Result<Vec<(Vec<u8>, Vec<u8>)>> {
    if data.len() < 4 {
        return Err(corrupt("invalid-block"));
    }
    let count = u32::from_le_bytes(data[data.len() - 4..].try_into().unwrap()) as usize;
    let tail = 4usize
        .checked_mul(count + 1)
        .ok_or_else(|| corrupt("invalid-restarts"))?;
    if count == 0 || tail > data.len() {
        return Err(corrupt("invalid-restarts"));
    }
    let end = data.len() - tail;
    let mut offsets = vec![];
    for i in 0..count {
        offsets.push(
            u32::from_le_bytes(data[end + i * 4..end + i * 4 + 4].try_into().unwrap()) as usize,
        );
    }
    if offsets[0] != 0 || offsets.windows(2).any(|w| w[0] >= w[1]) || *offsets.last().unwrap() > end
    {
        return Err(corrupt("invalid-restarts"));
    }
    let mut r = Reader::new(&data[..end]);
    let mut prev = vec![];
    let mut starts = HashSet::new();
    let mut out = vec![];
    let mut expanded = 0usize;
    while r.pos < end {
        let start = r.pos;
        starts.insert(start);
        let shared = r.varint()? as usize;
        let unshared = r.varint()? as usize;
        let n = r.varint()? as usize;
        if shared > prev.len() || (offsets.contains(&start) && shared != 0) {
            return Err(corrupt("invalid-shared-key"));
        }
        prev.truncate(shared);
        prev.extend(r.take(unshared)?);
        expanded = expanded
            .checked_add(prev.len())
            .and_then(|x| x.checked_add(n))
            .ok_or_else(|| unsupported("record-limit"))?;
        if out.len() >= 100_000 || expanded > 128 * 1024 * 1024 {
            return Err(unsupported("record-limit"));
        }
        out.push((prev.clone(), r.take(n)?.to_vec()));
    }
    if end > 0 && !offsets.iter().all(|x| starts.contains(x)) {
        return Err(corrupt("invalid-restarts"));
    }
    Ok(out)
}
fn table(data: &[u8]) -> Result<Vec<Record>> {
    if data.len() < 48 || data[data.len() - 8..] != [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]
    {
        return Err(corrupt("invalid-table-footer"));
    }
    let mut f = Reader::new(&data[data.len() - 48..data.len() - 8]);
    let meta = (f.varint()? as usize, f.varint()? as usize);
    let index = (f.varint()? as usize, f.varint()? as usize);
    let block = |h: (usize, usize)| -> Result<Vec<u8>> {
        let (o, n) = h;
        if o.checked_add(n)
            .and_then(|x| x.checked_add(5))
            .is_none_or(|x| x > data.len() - 48)
        {
            return Err(corrupt("invalid-block-handle"));
        }
        let kind = data[o + n];
        table_checksum(
            &data[o..o + n],
            kind,
            u32::from_le_bytes(data[o + n + 1..o + n + 5].try_into().unwrap()),
        )?;
        match kind {
            0 => Ok(data[o..o + n].to_vec()),
            1 => snappy(&data[o..o + n]),
            _ => Err(unsupported("table-compression")),
        }
    };
    for (_, h) in entries(&block(meta)?)? {
        let mut r = Reader::new(&h);
        let b = block((r.varint()? as usize, r.varint()? as usize))?;
        drop(b);
        r.done()?;
    }
    let mut out = vec![];
    let mut total = 0usize;
    for (_, h) in entries(&block(index)?)? {
        let mut r = Reader::new(&h);
        let payload = block((r.varint()? as usize, r.varint()? as usize))?;
        r.done()?;
        for (k, v) in entries(&payload)? {
            if k.len() < 8 {
                return Err(corrupt("invalid-internal-key"));
            }
            let trailer = u64::from_le_bytes(k[k.len() - 8..].try_into().unwrap());
            match trailer as u8 {
                kind @ (0 | 1) => {
                    total = total
                        .checked_add(k.len() - 8)
                        .and_then(|x| x.checked_add(if kind == 1 { v.len() } else { 0 }))
                        .ok_or_else(|| unsupported("record-limit"))?;
                    if out.len() >= 100_000 || total > 128 * 1024 * 1024 {
                        return Err(unsupported("record-limit"));
                    }
                    out.push((
                        k[..k.len() - 8].to_vec(),
                        trailer >> 8,
                        if kind == 1 { Some(v) } else { None },
                    ));
                }
                _ => return Err(unsupported("record-type")),
            }
        }
    }
    Ok(out)
}

fn read_snapshot(path: &Path) -> Result<Vec<Record>> {
    let current = fs::read(path.join("CURRENT"))?;
    if !current.starts_with(b"MANIFEST-")
        || !current.ends_with(b"\n")
        || current[9..current.len() - 1]
            .iter()
            .any(|b| !b.is_ascii_digit())
    {
        return Err(corrupt("invalid-current"));
    }
    let manifest = fs::read(
        path.join(
            std::str::from_utf8(&current[..current.len() - 1])
                .map_err(|_| corrupt("invalid-current"))?,
        ),
    )?;
    let mut tables = BTreeMap::new();
    let (mut log, mut previous, mut comparator) = (None, 0, None);
    for payload in log_records(&manifest)? {
        let mut r = Reader::new(&payload);
        while r.pos < payload.len() {
            let tag = r.varint()?;
            match tag {
                1 => comparator = Some(r.blob()?.to_vec()),
                2 | 3 | 4 | 9 => {
                    let v = r.varint()?;
                    if tag == 2 {
                        log = Some(v)
                    } else if tag == 9 {
                        previous = v
                    }
                }
                5 => {
                    r.varint()?;
                    r.blob()?;
                }
                6 => {
                    r.varint()?;
                    let n = r.varint()?;
                    tables.remove(&n);
                }
                7 => {
                    r.varint()?;
                    let n = r.varint()?;
                    let size = r.varint()?;
                    r.blob()?;
                    r.blob()?;
                    tables.insert(n, size);
                }
                _ => return Err(unsupported("manifest-tag")),
            }
        }
    }
    let log = log.ok_or_else(|| unsupported("database-format"))?;
    if comparator.as_deref() != Some(b"idb_cmp1") {
        return Err(unsupported("database-format"));
    }
    let mut records = vec![];
    let mut bytes = 0usize;
    let mut append = |x: Record| -> Result<()> {
        bytes = bytes.saturating_add(x.0.len() + x.2.as_ref().map_or(0, Vec::len));
        if records.len() >= 100000 || bytes > 128 * 1024 * 1024 {
            return Err(unsupported("record-limit"));
        }
        records.push(x);
        Ok(())
    };
    for (n, size) in tables {
        let choices = [
            path.join(format!("{n:06}.ldb")),
            path.join(format!("{n:06}.sst")),
        ];
        let found: Vec<_> = choices.iter().filter(|p| p.exists()).collect();
        if found.len() != 1 || fs::metadata(found[0])?.len() != size {
            return Err(corrupt("missing-table"));
        }
        for x in table(&fs::read(found[0])?)? {
            append(x)?
        }
    }
    if log != 0 && !path.join(format!("{log:06}.log")).is_file() {
        return Err(corrupt("missing-log"));
    }
    let mut logs: Vec<_> = fs::read_dir(path)?
        .filter_map(|x| x.ok().map(|x| x.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .collect();
    logs.sort();
    for file in logs {
        let Some(n) = file
            .file_stem()
            .and_then(|x| x.to_str())
            .and_then(|x| x.parse::<u64>().ok())
        else {
            continue;
        };
        if n < log && n != previous {
            continue;
        }
        for payload in log_records(&fs::read(file)?)? {
            let mut r = Reader::new(&payload);
            let seq = r.int(8)?;
            let count = r.int(4)?;
            if count > 1_000_000 || seq.checked_add(count).is_none_or(|x| x > 1 << 56) {
                return Err(unsupported("record-limit"));
            }
            for i in 0..count {
                let kind = r.int(1)?;
                let key = r.blob()?.to_vec();
                match kind {
                    0 => append((key, seq + i, None))?,
                    1 => {
                        let value = r.blob()?.to_vec();
                        append((key, seq + i, Some(value)))?
                    }
                    _ => return Err(unsupported("record-type")),
                }
            }
            r.done()?
        }
    }
    Ok(records)
}

fn prefix<'a>(key: &'a [u8]) -> Result<((u64, u64, u64), Reader<'a>)> {
    let mut r = Reader::new(key);
    let sizes = r.int(1)?;
    let a = r.int((sizes >> 5) as usize + 1)?;
    let b = r.int(((sizes >> 2) & 7) as usize + 1)?;
    let c = r.int((sizes & 3) as usize + 1)?;
    Ok(((a, b, c), r))
}
fn string16(r: &mut Reader<'_>) -> Result<String> {
    let n = r.varint()? as usize;
    let raw = r.take(n.checked_mul(2).ok_or_else(|| corrupt("truncated-data"))?)?;
    let words: Vec<u16> = raw
        .as_chunks::<2>()
        .0
        .iter()
        .map(|x| u16::from_be_bytes(*x))
        .collect();
    String::from_utf16(&words).map_err(|_| unsupported("settings-value"))
}

#[derive(Clone)]
enum Js {
    Null,
    Bool(bool),
    Int(i64),
    UInt(u64),
    Num(f64),
    Str(String),
    Object(Map<String, Value>),
    Array(Vec<Value>),
    Undefined,
}
fn json_of(v: Js) -> Value {
    match v {
        Js::Null => Value::Null,
        Js::Bool(x) => Value::Bool(x),
        Js::Int(x) => Value::Number(x.into()),
        Js::UInt(x) => Value::Number(x.into()),
        Js::Num(x) => serde_json::Number::from_f64(x)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        Js::Str(x) => Value::String(x),
        Js::Object(x) => Value::Object(x),
        Js::Array(x) => Value::Array(x),
        Js::Undefined => Value::Null,
    }
}
fn value(data: &[u8]) -> Result<Value> {
    fn peek(r: &mut Reader<'_>) -> Result<u8> {
        while r.data.get(r.pos) == Some(&0) {
            r.pos += 1;
        }
        r.data
            .get(r.pos)
            .copied()
            .ok_or_else(|| corrupt("truncated-v8"))
    }
    fn metrics(
        value: &Value,
        remaining_nodes: usize,
        remaining_bytes: usize,
    ) -> Result<(usize, usize, usize)> {
        if remaining_nodes == 0 {
            return Err(unsupported("value-limit"));
        }
        let mut total = 1;
        let mut bytes = match value {
            Value::String(x) => x.len(),
            Value::Object(values) => values
                .keys()
                .try_fold(1usize, |n, key| n.checked_add(key.len()))
                .ok_or_else(|| unsupported("value-limit"))?,
            _ => 1,
        };
        if bytes > remaining_bytes {
            return Err(unsupported("value-limit"));
        }
        let mut depth = 1;
        let children: Box<dyn Iterator<Item = &Value> + '_> = match value {
            Value::Array(values) => Box::new(values.iter()),
            Value::Object(values) => Box::new(values.values()),
            _ => return Ok((1, bytes, 1)),
        };
        for child in children {
            let (count, child_bytes, child_depth) = metrics(
                child,
                remaining_nodes.saturating_sub(total),
                remaining_bytes.saturating_sub(bytes),
            )?;
            total = total
                .checked_add(count)
                .ok_or_else(|| unsupported("value-limit"))?;
            bytes = bytes
                .checked_add(child_bytes)
                .ok_or_else(|| unsupported("value-limit"))?;
            depth = depth.max(child_depth + 1);
            if total > remaining_nodes || bytes > remaining_bytes || depth > 32 {
                return Err(unsupported("value-limit"));
            }
        }
        Ok((total, bytes, depth))
    }
    fn read(
        r: &mut Reader<'_>,
        depth: usize,
        nodes: &mut usize,
        objects: &mut Vec<Value>,
        active: &mut HashSet<usize>,
        expanded: &mut usize,
        expanded_bytes: &mut usize,
    ) -> Result<Js> {
        if depth > 32 || *nodes >= 20000 || *expanded >= 20_000 {
            return Err(unsupported("value-limit"));
        }
        *nodes += 1;
        *expanded += 1;
        while r.data.get(r.pos) == Some(&0) {
            r.pos += 1;
        }
        let tag = r.int(1)? as u8;
        match tag {
            b'0' => Ok(Js::Null),
            b'T' => Ok(Js::Bool(true)),
            b'F' => Ok(Js::Bool(false)),
            b'I' => {
                let n = r.varint()?;
                if n > u32::MAX as u64 {
                    return Err(corrupt("invalid-v8-integer"));
                }
                Ok(Js::Int(
                    ((n as u32 >> 1) as i32 ^ -((n as u32 & 1) as i32)) as i64,
                ))
            }
            b'U' => {
                let n = r.varint()?;
                if n > u32::MAX as u64 {
                    return Err(corrupt("invalid-v8-integer"));
                }
                Ok(Js::UInt(n))
            }
            b'N' => {
                let x = f64::from_le_bytes(r.take(8)?.try_into().unwrap());
                if !x.is_finite() {
                    return Err(unsupported("non-finite-value"));
                }
                Ok(Js::Num(x))
            }
            b'S' => {
                let bytes = r.blob()?;
                *expanded_bytes = expanded_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(|| unsupported("value-limit"))?;
                if *expanded_bytes > 128 * 1024 * 1024 {
                    return Err(unsupported("value-limit"));
                }
                let s =
                    String::from_utf8(bytes.to_vec()).map_err(|_| unsupported("settings-value"))?;
                Ok(Js::Str(s))
            }
            b'"' => {
                let n = r.varint()? as usize;
                *expanded_bytes = expanded_bytes
                    .checked_add(n)
                    .ok_or_else(|| unsupported("value-limit"))?;
                if *expanded_bytes > 128 * 1024 * 1024 {
                    return Err(unsupported("value-limit"));
                }
                Ok(Js::Str(r.take(n)?.iter().map(|b| *b as char).collect()))
            }
            b'c' => {
                let n = r.varint()? as usize;
                *expanded_bytes = expanded_bytes
                    .checked_add(n)
                    .ok_or_else(|| unsupported("value-limit"))?;
                if *expanded_bytes > 128 * 1024 * 1024 {
                    return Err(unsupported("value-limit"));
                }
                let raw = r.take(n)?;
                if raw.len() % 2 != 0 {
                    return Err(unsupported("settings-value"));
                }
                let words = raw
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|x| u16::from_le_bytes(*x))
                    .collect::<Vec<_>>();
                Ok(Js::Str(
                    String::from_utf16(&words).map_err(|_| unsupported("settings-value"))?,
                ))
            }
            b'_' => Ok(Js::Undefined),
            b'^' => {
                let i = r.varint()? as usize;
                if active.contains(&i) {
                    return Err(unsupported("cyclic-reference"));
                }
                let object = objects.get(i).ok_or_else(|| corrupt("invalid-reference"))?;
                let (added, bytes, object_depth) = metrics(
                    object,
                    20_000usize.saturating_sub(*expanded),
                    128 * 1024 * 1024usize - (*expanded_bytes).min(128 * 1024 * 1024),
                )?;
                if depth + object_depth > 32 {
                    return Err(unsupported("value-limit"));
                }
                *expanded += added;
                *expanded_bytes += bytes;
                Some(object.clone())
                    .map(|x| match x {
                        Value::Object(x) => Js::Object(x),
                        Value::Array(x) => Js::Array(x),
                        _ => Js::Null,
                    })
                    .ok_or_else(|| corrupt("invalid-reference"))
            }
            b'o' => {
                let idx = objects.len();
                objects.push(Value::Null);
                active.insert(idx);
                let mut obj = Map::new();
                let mut seen = HashSet::new();
                let mut count = 0;
                while peek(r)? != b'{' {
                    let Js::Str(k) = read(
                        r,
                        depth + 1,
                        nodes,
                        objects,
                        active,
                        expanded,
                        expanded_bytes,
                    )?
                    else {
                        return Err(unsupported("object-key"));
                    };
                    if !seen.insert(k.clone()) {
                        return Err(unsupported("object-key"));
                    }
                    let v = read(
                        r,
                        depth + 1,
                        nodes,
                        objects,
                        active,
                        expanded,
                        expanded_bytes,
                    )?;
                    count += 1;
                    if !matches!(v, Js::Undefined) {
                        obj.insert(k, json_of(v));
                    }
                }
                r.pos += 1;
                if r.varint()? != count {
                    return Err(corrupt("object-size"));
                }
                active.remove(&idx);
                let stored = Value::Object(obj);
                let (_, bytes, _) = metrics(
                    &stored,
                    20_000,
                    128 * 1024 * 1024usize - (*expanded_bytes).min(128 * 1024 * 1024),
                )?;
                *expanded_bytes += bytes;
                objects[idx] = stored.clone();
                let Value::Object(obj) = stored else {
                    unreachable!()
                };
                Ok(Js::Object(obj))
            }
            b'a' => {
                let len = r.varint()? as usize;
                if len > 10_000 {
                    return Err(unsupported("value-limit"));
                }
                *expanded = expanded
                    .checked_add(len)
                    .ok_or_else(|| unsupported("value-limit"))?;
                *expanded_bytes = expanded_bytes
                    .checked_add(len)
                    .ok_or_else(|| unsupported("value-limit"))?;
                if *expanded > 20_000 || *expanded_bytes > 128 * 1024 * 1024 {
                    return Err(unsupported("value-limit"));
                }
                let idx = objects.len();
                objects.push(Value::Null);
                active.insert(idx);
                let mut a = vec![Value::Null; len];
                let mut count = 0;
                while peek(r)? != b'@' {
                    let index = match read(
                        r,
                        depth + 1,
                        nodes,
                        objects,
                        active,
                        expanded,
                        expanded_bytes,
                    )? {
                        Js::Int(x) if x >= 0 && x < len as i64 => x as usize,
                        Js::UInt(x) if x < len as u64 => x as usize,
                        Js::Num(x) if x.fract() == 0.0 && x >= 0.0 && x < len as f64 => x as usize,
                        Js::Str(x) => x
                            .parse::<usize>()
                            .ok()
                            .filter(|x| *x < len)
                            .ok_or_else(|| unsupported("array-properties"))?,
                        _ => return Err(unsupported("array-properties")),
                    };
                    let item = read(
                        r,
                        depth + 1,
                        nodes,
                        objects,
                        active,
                        expanded,
                        expanded_bytes,
                    )?;
                    a[index] = if matches!(item, Js::Undefined) {
                        Value::Null
                    } else {
                        json_of(item)
                    };
                    count += 1;
                }
                r.pos += 1;
                if r.varint()? != count || r.varint()? != len as u64 {
                    return Err(corrupt("array-size"));
                }
                active.remove(&idx);
                let stored = Value::Array(a);
                let (_, bytes, _) = metrics(
                    &stored,
                    20_000,
                    128 * 1024 * 1024usize - (*expanded_bytes).min(128 * 1024 * 1024),
                )?;
                *expanded_bytes += bytes;
                objects[idx] = stored.clone();
                let Value::Array(a) = stored else {
                    unreachable!()
                };
                Ok(Js::Array(a))
            }
            b'A' => {
                let len = r.varint()? as usize;
                if len > 10000 {
                    return Err(unsupported("value-limit"));
                }
                let idx = objects.len();
                objects.push(Value::Null);
                active.insert(idx);
                let mut a = vec![];
                for _ in 0..len {
                    let x = read(
                        r,
                        depth + 1,
                        nodes,
                        objects,
                        active,
                        expanded,
                        expanded_bytes,
                    )?;
                    if matches!(x, Js::Undefined) {
                        return Err(unsupported("array-undefined"));
                    }
                    a.push(json_of(x));
                }
                if peek(r)? != b'$' {
                    return Err(unsupported("array-properties"));
                }
                r.pos += 1;
                if r.varint()? != 0 || r.varint()? != len as u64 {
                    return Err(corrupt("array-size"));
                }
                active.remove(&idx);
                let stored = Value::Array(a);
                let (_, bytes, _) = metrics(
                    &stored,
                    20_000,
                    128 * 1024 * 1024usize - (*expanded_bytes).min(128 * 1024 * 1024),
                )?;
                *expanded_bytes += bytes;
                objects[idx] = stored.clone();
                let Value::Array(a) = stored else {
                    unreachable!()
                };
                Ok(Js::Array(a))
            }
            _ => Err(unsupported("v8-value-type")),
        }
    }
    let mut r = Reader::new(data);
    r.varint()?;
    if r.int(1)? != 255 {
        return Err(unsupported("blink-format"));
    }
    let blink = r.varint()?;
    if !(16..=21).contains(&blink) {
        return Err(unsupported("blink-version"));
    }
    if blink >= 21 {
        if r.int(1)? != 254 {
            return Err(corrupt("blink-trailer"));
        }
        let offset = u64::from_be_bytes(r.take(8)?.try_into().unwrap());
        let size = u32::from_be_bytes(r.take(4)?.try_into().unwrap());
        if offset != 0 || size != 0 {
            return Err(unsupported("blink-trailer"));
        }
    }
    if r.int(1)? != 255 || r.varint()? != 15 {
        return Err(unsupported("v8-version"));
    }
    while r.data.get(r.pos) == Some(&0) {
        r.pos += 1
    }
    let js = read(
        &mut r,
        0,
        &mut 0,
        &mut vec![],
        &mut HashSet::new(),
        &mut 0,
        &mut 0,
    )?;
    r.done()?;
    match js {
        Js::Object(x) => Ok(Value::Object(x)),
        _ => Err(unsupported("settings-shape")),
    }
}

fn decode(path: &Path) -> Result<Decoded> {
    fn nodes(value: &Value) -> usize {
        match value {
            Value::Array(x) => 1 + x.iter().map(nodes).sum::<usize>(),
            Value::Object(x) => 1 + x.values().map(nodes).sum::<usize>(),
            _ => 1,
        }
    }
    let records = read_snapshot(path)?;
    let mut latest: HashMap<Vec<u8>, (u64, Option<Vec<u8>>)> = HashMap::new();
    for (k, s, v) in &records {
        match latest.get(k) {
            Some((old, prior)) if *old > *s => {}
            Some((old, prior)) if *old == *s && prior != v => {
                return Err(corrupt("conflicting-record"))
            }
            _ => {
                latest.insert(k.clone(), (*s, v.clone()));
            }
        }
    }
    let scopes = b"\0\0\0\0\x32";
    for (key, (_, data)) in &latest {
        let Some(data) = data else { continue };
        if key.starts_with(scopes) {
            if key == b"\0\0\0\0\x32\0" {
                if data.as_slice() != b"\x08\x01" {
                    return Err(unsupported("scopes-version"));
                }
            } else {
                return Err(unsupported("database-recovery-required"));
            }
        }
    }
    if latest
        .get(&vec![0, 0, 0, 0, 0])
        .and_then(|x| x.1.as_deref())
        != Some(&[5])
        || latest
            .get(&vec![0, 0, 0, 0, 2])
            .and_then(|x| x.1.as_deref())
            != Some(&[0x15, 0, 0, 0, 0x0f])
    {
        return Err(unsupported("database-version"));
    }
    let mut databases = vec![];
    for (k, (_, stored)) in &latest {
        if let Some(v) = stored
            .as_ref()
            .filter(|_| k.starts_with(&[0, 0, 0, 0, 0xc9]))
        {
            let mut r = Reader::new(&k[5..]);
            let origin = string16(&mut r)?;
            let name = string16(&mut r)?;
            r.done()?;
            if (origin == "file__0" || origin == "file__0@1") && name == "ngStorage" {
                if v.len() > 8 {
                    return Err(unsupported("database-version"));
                }
                databases.push(
                    v.iter()
                        .enumerate()
                        .fold(0u64, |a, (i, b)| a | (*b as u64) << (8 * i)),
                );
            }
        }
    }
    if databases.is_empty() {
        return Ok((HashMap::new(), vec![]));
    }
    if databases.len() != 1 {
        return Err(unsupported("ambiguous-database"));
    }
    let db = databases[0];
    let mut stores = vec![];
    for (k, (_, v)) in &latest {
        let Ok((ids, mut r)) = prefix(k) else {
            continue;
        };
        if ids == (db, 0, 0) && r.pos < k.len() && r.int(1)? == 50 {
            let store = r.varint()?;
            let kind = r.int(1)?;
            r.done()?;
            if kind == 0
                && v.as_ref().is_some_and(|x| {
                    let words: Vec<u16> = x
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|c| u16::from_be_bytes(*c))
                        .collect();
                    String::from_utf16(&words).ok().as_deref() == Some("localStorage")
                })
            {
                stores.push(store)
            }
        }
    }
    if stores.is_empty() {
        return Ok((HashMap::new(), vec![]));
    }
    if stores.len() != 1 {
        return Err(unsupported("ambiguous-store"));
    }
    let names = [
        ("bps.setting", "graph"),
        ("setting.IndicatorSettingService", "indicator"),
        ("setting.GlobalSettingService", "global"),
        ("roasting-machine.RoastingMachineService", "machine"),
    ];
    let mut settings = HashMap::new();
    let mut history = vec![];
    let (mut retained_nodes, mut retained_bytes) = (0usize, 0usize);
    for (k, s, v) in records {
        let Ok((ids, mut r)) = prefix(&k) else {
            continue;
        };
        if ids != (db, stores[0], 1) || r.int(1)? != 1 {
            continue;
        }
        let name = string16(&mut r)?;
        r.done()?;
        let Some((_, key)) = names.iter().find(|x| x.0 == name) else {
            continue;
        };
        let current = latest.get(&k).is_some_and(|x| x.0 == s);
        if let Some(data) = v {
            if !current && name != "roasting-machine.RoastingMachineService" {
                continue;
            }
            let decoded = value(&data)?;
            let copies = usize::from(current)
                + usize::from(name == "roasting-machine.RoastingMachineService");
            let decoded_bytes = serde_json::to_vec(&decoded)
                .map_err(|_| unsupported("value-limit"))?
                .len();
            retained_nodes = retained_nodes
                .checked_add(nodes(&decoded).saturating_mul(copies))
                .ok_or_else(|| unsupported("value-limit"))?;
            retained_bytes = retained_bytes
                .checked_add(decoded_bytes.saturating_mul(copies))
                .ok_or_else(|| unsupported("value-limit"))?;
            if retained_nodes > 100_000 || retained_bytes > 128 * 1024 * 1024 {
                return Err(unsupported("value-limit"));
            }
            if current {
                settings.insert(*key, Some(decoded.clone()));
            }
            if name == "roasting-machine.RoastingMachineService" {
                history.push((s, current, decoded));
            }
        } else if current {
            settings.insert(*key, None);
        }
    }
    Ok((settings, history))
}

fn response(status: &str, reason: Option<&str>) -> Value {
    let mut v = json!({"status":status,"source":{"product":"Firescope","version":null},"graph":null,"graphTemperatureUnit":null,"indicator":null,"global":null,"machines":[]});
    if let Some(x) = reason {
        v["reason"] = Value::String(x.into())
    }
    v
}
fn fields(v: &Value, allowed: &[&str]) -> Result<Value> {
    let obj = v.as_object().ok_or_else(|| unsupported("settings-shape"))?;
    let mut out = Map::new();
    for k in allowed {
        if let Some(v) = obj.get(*k) {
            if !matches!(
                v,
                Value::Null | Value::Bool(_) | Value::String(_) | Value::Number(_)
            ) {
                return Err(unsupported("settings-shape"));
            }
            if v.as_str().is_some_and(|x| x.chars().count() > 1024) {
                return Err(unsupported("settings-value"));
            }
            out.insert((*k).into(), v.clone());
        }
    }
    Ok(Value::Object(out))
}
fn machine(v: &Value) -> Result<Value> {
    let obj = v.as_object().ok_or_else(|| unsupported("settings-shape"))?;
    let mut out = fields(v, &["id", "name", "preset", "capacity", "temperatureUnit"])?
        .as_object()
        .unwrap()
        .clone();
    let conn = obj
        .get("connection")
        .ok_or_else(|| unsupported("machine-connection"))?;
    // Imports carry read settings only; source control/write settings stay excluded.
    let mut selected = fields(conn, &["driver", "type", "protocol", "slot"])?
        .as_object()
        .unwrap()
        .clone();
    let c = conn.as_object().unwrap();
    if let Some(t) = c
        .get("type")
        .and_then(Value::as_str)
        .filter(|x| matches!(*x, "serial" | "ethernet" | "managed" | "usb"))
    {
        if let Some(v) = c.get(t) {
            selected.insert(
                t.into(),
                fields(
                    v,
                    &[
                        "type", "path", "baudRate", "dataBits", "stopBits", "parity", "ip", "host",
                        "port",
                    ],
                )?,
            );
        }
    }
    if let Some(p) = c
        .get("protocol")
        .and_then(Value::as_str)
        .filter(|x| matches!(*x, "modbus" | "s7" | "phidget" | "websocket" | "usb"))
    {
        if let Some(v) = c.get(p) {
            let a = v.as_array().ok_or_else(|| unsupported("sensor-shape"))?;
            if a.len() > 128 {
                return Err(unsupported("sensor-shape"));
            }
            selected.insert(
                p.into(),
                Value::Array(
                    a.iter()
                        .map(|x| {
                            fields(
                                x,
                                &[
                                    "label",
                                    "length",
                                    "type",
                                    "address",
                                    "start",
                                    "read",
                                    "sensorId",
                                    "decimalPlace",
                                    "unit",
                                    "compensation",
                                    "hubId",
                                    "thermocoupleType",
                                    "rtdType",
                                    "rtdWire",
                                    "wordOrder",
                                    "byteOrder",
                                    "enabled",
                                    "name",
                                ],
                            )
                        })
                        .collect::<Result<_>>()?,
                ),
            );
        }
    }
    out.insert("connection".into(), Value::Object(selected));
    Ok(Value::Object(out))
}

pub(super) fn extract(path: &Path) -> Result<Value> {
    let (settings, history) = decode(path)?;
    if settings.is_empty() && history.is_empty() {
        return Ok(response("not-found", Some("settings-not-found")));
    }
    let mut result = response("found", None);
    for (k, a) in [
        (
            "graph",
            &[
                "temperatureUnit",
                "xAxisStart",
                "xAxisEnd",
                "xAxisScaleUnit",
                "yAxisStart",
                "yAxisEnd",
                "btLineColor",
                "etLineColor",
                "rorLineColor",
                "btRorLineColor",
                "etRorLineColor",
                "btLineWidth",
                "etLineWidth",
                "rorLineWidth",
                "btRorLineWidth",
                "etRorLineWidth",
                "rorYAxisStart",
                "rorYAxisEnd",
                "rorInterval",
                "dryingEndTemp",
                "crackStartTemp",
                "xAxisAutoExtend",
                "y2AxisStart",
                "y2AxisEnd",
                "etLineVisible",
                "btRorLineVisible",
                "etRorLineVisible",
                "indicatorRorUnit",
                "checkDryingEndEvent",
                "checkFirstCrackEvent",
                "checkChargeTempDescending",
                "chargeTempGap",
                "checkDropTempDescending",
                "dropTempGap",
            ][..],
        ),
        (
            "indicator",
            &["developmentTimeVisible", "rorInterval", "etBtSwapped"],
        ),
        ("global", &["temperature"]),
    ] {
        if let Some(Some(v)) = settings.get(k) {
            result[k] = fields(v, a)?;
        }
    }
    if let Some(Some(g)) = settings.get("graph") {
        if let Some(e) = g.get("event") {
            result["graph"]["event"] = fields(
                e,
                &[
                    "airSpeedEventName",
                    "fireEventName",
                    "isExtraLabelVisible",
                    "temperatureType",
                ],
            )?;
        }
    }
    if let Some(Some(m)) = settings.get("machine") {
        if let Some(unit) = fields(m, &["temperatureUnit"])?
            .get("temperatureUnit")
            .and_then(Value::as_str)
        {
            result["graphTemperatureUnit"] = Value::String(unit.into());
        }
    }
    let mut grouped: HashMap<(u8, String), (u64, bool, Value)> = HashMap::new();
    for (s, current, v) in history {
        if v.get("preset").and_then(Value::as_str) == Some("test")
            || v.get("connection")
                .and_then(|x| x.get("driver"))
                .and_then(Value::as_str)
                == Some("DummyDriver")
        {
            continue;
        }
        let clean = machine(&v)?;
        let id = clean
            .get("id")
            .ok_or_else(|| unsupported("machine-identity"))?;
        let key = match id {
            Value::String(x) => (0, x.clone()),
            Value::Number(x) if x.is_i64() || x.is_u64() => (1, x.to_string()),
            _ => return Err(unsupported("machine-identity")),
        };
        if grouped.get(&key).is_none_or(|x| x.0 < s) {
            grouped.insert(key, (s, current, clean));
        }
    }
    let mut machines: Vec<_> = grouped.into_values().collect();
    machines.sort_by_key(|x| std::cmp::Reverse(x.0));
    result["machines"]=Value::Array(machines.into_iter().map(|(sequence,current,settings)|json!({"sequence":sequence,"current":current,"settings":settings})).collect());
    Ok(result)
}

#[cfg(not(target_os = "macos"))]
pub(super) fn scan(_home: &Path) -> Value {
    response("unsupported", Some("platform"))
}

#[cfg(target_os = "macos")]
pub(super) fn scan(home: &Path) -> Value {
    fn inner(home: &Path) -> Result<Value> {
        use sha2::{Digest, Sha256};
        use std::os::fd::AsRawFd;
        fn inventory(path: &Path) -> Result<Vec<(std::ffi::OsString, super::Fingerprint)>> {
            let mut files = vec![];
            let mut total = 0u64;
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let meta = fs::symlink_metadata(entry.path())?;
                if !meta.file_type().is_file() {
                    return Err(unsupported("database-files"));
                }
                total = total
                    .checked_add(meta.len())
                    .ok_or_else(|| unsupported("size-limit"))?;
                if files.len() >= 512 || total > 128 * 1024 * 1024 || meta.len() > LIMIT as u64 {
                    return Err(unsupported("size-limit"));
                }
                files.push((entry.file_name(), super::identity(&meta)));
            }
            files.sort_by(|a, b| a.0.cmp(&b.0));
            Ok(files)
        }
        let source =
            home.join("Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb");
        if !source.exists() {
            return Ok(response("not-found", Some("database-not-found")));
        }
        super::reject_symlinks(home, &source).map_err(|error| match error {
            ImportError::Unsupported(_) => unsupported("database-files"),
            error => error,
        })?;
        if super::process_running(&["-x", "Firescope|Firescope Helper.*"])? {
            return Ok(response("needs-app-closed", Some("app-running")));
        }
        let lock = super::open_read(&source.join("LOCK"))?;
        let mut flock = libc::flock {
            l_type: libc::F_RDLCK,
            l_whence: libc::SEEK_SET as i16,
            l_start: 0,
            l_len: 0,
            l_pid: 0,
        };
        // Chromium's LevelDB lock uses POSIX record locks, so the probe must use the same lock family.
        if unsafe { libc::fcntl(lock.as_raw_fd(), libc::F_SETLK, &mut flock) } == -1 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Ok(response("needs-app-closed", Some("database-locked")));
            }
            return Err(error.into());
        }
        let temp = tempfile::Builder::new().prefix("fc-firescope-").tempdir()?;
        let before = inventory(&source)?;
        let mut hashes = Vec::new();
        for (name, id) in &before {
            if name == "LOCK" {
                continue;
            }
            let data = super::read_stable(&source.join(name), id, LIMIT as u64)?;
            hashes.push((name.clone(), Sha256::digest(&data)));
            fs::write(temp.path().join(name), data)?;
        }
        if super::process_running(&["-x", "Firescope|Firescope Helper.*"])?
            || inventory(&source)? != before
        {
            return Ok(response("needs-app-closed", Some("database-changed")));
        }
        for (name, digest) in &hashes {
            let id = before.iter().find(|x| x.0 == *name).unwrap();
            if Sha256::digest(super::read_stable(&source.join(name), &id.1, LIMIT as u64)?)
                != *digest
            {
                return Ok(response("needs-app-closed", Some("database-changed")));
            }
        }
        if inventory(&source)? != before {
            return Ok(response("needs-app-closed", Some("database-changed")));
        }
        let result = extract(temp.path())?;
        if inventory(&source)? != before
            || super::process_running(&["-x", "Firescope|Firescope Helper.*"])?
        {
            return Ok(response("needs-app-closed", Some("database-changed")));
        }
        drop(lock);
        Ok(result)
    }
    match inner(home) {
        Ok(v) => v,
        Err(ImportError::Unsupported("settings-files")) => {
            response("unsupported", Some("database-files"))
        }
        Err(ImportError::Unsupported(reason)) => response("unsupported", Some(reason)),
        Err(ImportError::Changed) => response("needs-app-closed", Some("database-changed")),
        Err(_) => response("unreadable", Some("database-unreadable")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNICODE: &str = "ff0f6f22046e616d6500630a5cb8a4c230d1200015262204756e69742202b0432207656e61626c65644622016e49007b04";
    const GRAPH: &str = "ff0f6f220a79417869735374617274496422087941786973456e6449f40322087841786973456e6449a00b7b03";
    const MACHINE: &str = "ff0f6f2202696422026d3122046e616d6522074d616368696e6522067072657365742206637573746f6d220f74656d7065726174757265556e69742202b043220a636f6e6e656374696f6e6f2206647269766572220c4d6f64627573447269766572220474797065220673657269616c220870726f746f636f6c22066d6f64627573220673657269616c6f2204747970652203525455220470617468220c2f6465762f6578616d706c652208626175645261746549809601220864617461426974734910220873746f70426974734904220670617269747922046e6f6e657b0622066d6f6462757341016f22056c6162656c2202425422076164647265737349d00f220873656e736f724964490222047265616422034643342204747970652207696e7465676572220c646563696d616c506c6163654902220c636f6d70656e736174696f6e49002204756e69742202b0437b08240001220870617373776f7264220668696464656e7b062205746f6b656e220668696464656e7b06";

    fn hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|x| u8::from_str_radix(std::str::from_utf8(x).unwrap(), 16).unwrap())
            .collect()
    }
    fn varint(mut n: u64) -> Vec<u8> {
        let mut out = vec![];
        while n >= 128 {
            out.push((n as u8 & 127) | 128);
            n >>= 7
        }
        out.push(n as u8);
        out
    }
    fn blob(data: &[u8]) -> Vec<u8> {
        let mut out = varint(data.len() as u64);
        out.extend(data);
        out
    }
    fn text16(s: &str) -> Vec<u8> {
        let raw: Vec<_> = s.encode_utf16().flat_map(u16::to_be_bytes).collect();
        let mut out = varint((raw.len() / 2) as u64);
        out.extend(raw);
        out
    }
    fn envelope(v8: &[u8]) -> Vec<u8> {
        let mut out = vec![1, 255, 21, 254];
        out.extend([0; 12]);
        out.extend(v8);
        out
    }
    fn log(payload: &[u8]) -> Vec<u8> {
        let mut checked = vec![1];
        checked.extend(payload);
        let crc = crc32c(&checked).rotate_right(15).wrapping_add(0xa282ead8);
        let mut out = crc.to_le_bytes().to_vec();
        out.extend((payload.len() as u16).to_le_bytes());
        out.push(1);
        out.extend(payload);
        out
    }
    fn batch(sequence: u64, rows: &[(Vec<u8>, Option<Vec<u8>>)]) -> Vec<u8> {
        let mut p = sequence.to_le_bytes().to_vec();
        p.extend((rows.len() as u32).to_le_bytes());
        for (k, v) in rows {
            p.push(u8::from(v.is_some()));
            p.extend(blob(k));
            if let Some(v) = v {
                p.extend(blob(v));
            }
        }
        log(&p)
    }
    fn key(name: &str, db: u8) -> Vec<u8> {
        let mut out = vec![0, db, 1, 1, 1];
        out.extend(text16(name));
        out
    }
    fn graph_key() -> Vec<u8> {
        key("bps.setting", 2)
    }
    fn db_name() -> Vec<u8> {
        let mut x = vec![0, 0, 0, 0, 0xc9];
        x.extend(text16("file__0@1"));
        x.extend(text16("ngStorage"));
        x
    }
    fn metadata() -> Vec<(Vec<u8>, Option<Vec<u8>>)> {
        vec![
            (vec![0, 0, 0, 0, 0], Some(vec![5])),
            (vec![0, 0, 0, 0, 2], Some(vec![0x15, 0, 0, 0, 0x0f])),
            (db_name(), Some(vec![2])),
            (
                vec![0, 2, 0, 0, 0x32, 1, 0],
                Some(
                    "localStorage"
                        .encode_utf16()
                        .flat_map(u16::to_be_bytes)
                        .collect(),
                ),
            ),
        ]
    }
    fn snapshot(rows: &[(Vec<u8>, Option<Vec<u8>>)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("CURRENT"), b"MANIFEST-000001\n").unwrap();
        let mut manifest = vec![1];
        manifest.extend(blob(b"idb_cmp1"));
        manifest.extend([2, 2]);
        fs::write(dir.path().join("MANIFEST-000001"), log(&manifest)).unwrap();
        let mut wal = batch(1, &metadata());
        wal.extend(batch(100, rows));
        fs::write(dir.path().join("000002.log"), wal).unwrap();
        fs::write(dir.path().join("LOCK"), []).unwrap();
        dir
    }
    fn block(rows: &[(Vec<u8>, Vec<u8>)]) -> Vec<u8> {
        let mut out = vec![];
        for (k, v) in rows {
            out.push(0);
            out.extend(varint(k.len() as u64));
            out.extend(varint(v.len() as u64));
            out.extend(k);
            out.extend(v);
        }
        out.extend(0u32.to_le_bytes());
        out.extend(1u32.to_le_bytes());
        out
    }
    fn add_block(out: &mut Vec<u8>, data: &[u8]) -> Vec<u8> {
        let mut handle = varint(out.len() as u64);
        handle.extend(varint(data.len() as u64));
        out.extend(data);
        out.push(0);
        let mut checked = data.to_vec();
        checked.push(0);
        out.extend(
            crc32c(&checked)
                .rotate_right(15)
                .wrapping_add(0xa282ead8)
                .to_le_bytes(),
        );
        handle
    }
    fn sstable(rows: &[Record]) -> Vec<u8> {
        let mut out = vec![];
        let payload = block(
            &rows
                .iter()
                .map(|(k, s, v)| {
                    let mut internal = k.clone();
                    internal.extend(((s << 8) | u64::from(v.is_some())).to_le_bytes());
                    (internal, v.clone().unwrap_or_default())
                })
                .collect::<Vec<_>>(),
        );
        let payload_h = add_block(&mut out, &payload);
        let meta = add_block(&mut out, &block(&[]));
        let index = add_block(&mut out, &block(&[(b"last".to_vec(), payload_h)]));
        let mut footer = meta;
        footer.extend(index);
        footer.resize(40, 0);
        out.extend(footer);
        out.extend(hex("57fb808b247547db"));
        out
    }

    #[test]
    fn v8_goldens_crc_and_snappy() {
        let unicode = value(&envelope(&hex(UNICODE))).unwrap();
        assert_eq!(
            unicode,
            json!({"name":"로스터 ☕","unit":"°C","enabled":false,"n":0})
        );
        assert_eq!(
            value(&envelope(&hex(GRAPH))).unwrap(),
            json!({"yAxisStart":50,"yAxisEnd":250,"xAxisEnd":720})
        );
        assert_eq!(crc32c(b"123456789"), 0xe3069283);
        assert_eq!(snappy(b"\x06\x00a\x12\x01\x00").unwrap(), b"aaaaaa");
        assert!(snappy(b"\x06\x12\x01\0").is_err());
        assert!(matches!(
            snappy(&varint(33 * 1024 * 1024)),
            Err(ImportError::Unsupported("size-limit"))
        ));
        let mut padded = hex(GRAPH);
        padded.insert(padded.len() - 2, 0);
        assert_eq!(value(&envelope(&padded)).unwrap()["xAxisEnd"], 720);
        let mut oversized_u = hex("ff0f6f22017855");
        oversized_u.extend(varint(u32::MAX as u64 + 1));
        oversized_u.extend([b'{', 1]);
        assert!(matches!(
            value(&envelope(&oversized_u)),
            Err(ImportError::Corrupt("invalid-v8-integer"))
        ));
    }

    #[test]
    fn machine_import_excludes_write_settings_and_preserves_ascii_reads() {
        let result = machine(&json!({
            "id": "ascii-machine",
            "name": "ASCII",
            "write_map": {"heater": {"register": 31}},
            "connection": {
                "driver": "ModbusDriver",
                "type": "serial",
                "protocol": "modbus",
                "serial": {"type": "ascii", "path": "COM5", "baudRate": 9600},
                "write_map": {"heater": {"register": 31}},
                "modbus": [{
                    "label": "bt", "address": 1000, "read": "FC4", "write": "FC6",
                    "sensorId": 1, "type": "integer", "decimalPlace": 1, "unit": "C",
                    "write_map": {"register": 31}
                }]
            }
        }))
        .unwrap();
        assert_eq!(result["connection"]["serial"]["type"], "ascii");
        assert_eq!(
            result["connection"]["modbus"],
            json!([{
                "label": "bt", "address": 1000, "read": "FC4", "sensorId": 1,
                "type": "integer", "decimalPlace": 1, "unit": "C"
            }])
        );
        assert!(result.get("write_map").is_none());
        assert!(result["connection"].get("write_map").is_none());
    }

    #[test]
    fn latest_tombstones_machine_history_and_secrets() {
        let mk = key("roasting-machine.RoastingMachineService", 2);
        let dir = snapshot(&[
            (graph_key(), Some(envelope(&hex(GRAPH)))),
            (mk.clone(), Some(envelope(&hex(MACHINE)))),
            (mk.clone(), Some(envelope(&hex(MACHINE)))),
            (mk, None),
            (key("auth", 2), Some(b"secret".to_vec())),
        ]);
        let result = extract(dir.path()).unwrap();
        assert_eq!(result["graph"]["xAxisEnd"], 720);
        assert_eq!(result["machines"][0]["sequence"], 102);
        assert_eq!(result["machines"][0]["current"], false);
        assert!(!result.to_string().contains("hidden"));
        assert!(!result.to_string().contains("password"));
        assert_eq!(
            result["machines"][0]["settings"]["connection"]["modbus"][0]["address"],
            1000
        );
    }

    #[test]
    fn current_machine_unit_and_string_number_identity() {
        let mk = key("roasting-machine.RoastingMachineService", 2);
        let dir = snapshot(&[(mk, Some(envelope(&hex(MACHINE))))]);
        let result = extract(dir.path()).unwrap();
        assert_eq!(result["machines"][0]["current"], true);
        assert_eq!(result["graphTemperatureUnit"], "°C");
        let string = json!({"id":"1","connection":{"driver":"x"}});
        let number = json!({"id":1,"connection":{"driver":"x"}});
        assert_ne!(
            match machine(&string).unwrap()["id"] {
                Value::String(ref x) => (0, x.clone()),
                _ => (1, String::new()),
            },
            match machine(&number).unwrap()["id"] {
                Value::Number(ref x) => (1, x.to_string()),
                _ => (0, String::new()),
            }
        );
    }

    #[test]
    fn metadata_setting_tombstones_and_wrong_database() {
        for deleted in [db_name(), vec![0, 2, 0, 0, 0x32, 1, 0], graph_key()] {
            let dir = snapshot(&[(graph_key(), Some(envelope(&hex(GRAPH)))), (deleted, None)]);
            assert!(extract(dir.path()).unwrap()["graph"].is_null());
        }
        let dir = snapshot(&[
            (graph_key(), Some(envelope(&hex(GRAPH)))),
            (key("bps.setting", 9), Some(b"bad".to_vec())),
        ]);
        fs::write(dir.path().join("MANIFEST-999999"), b"bad").unwrap();
        fs::write(dir.path().join("000001.log"), b"bad").unwrap();
        assert_eq!(extract(dir.path()).unwrap()["graph"]["yAxisStart"], 50);
    }

    #[test]
    fn bad_latest_crc_truncation_and_newer_wal() {
        for bad in [
            b"bad".to_vec(),
            envelope(b"\xff\x10o{\0"),
            b"\x01\xff\x11\x01".to_vec(),
        ] {
            let dir = snapshot(&[
                (graph_key(), Some(envelope(&hex(GRAPH)))),
                (graph_key(), Some(bad)),
            ]);
            assert!(decode(dir.path()).is_err());
        }
        let dir = snapshot(&[
            (graph_key(), Some(b"old-invalid".to_vec())),
            (graph_key(), Some(envelope(&hex(GRAPH)))),
        ]);
        assert_eq!(extract(dir.path()).unwrap()["graph"]["xAxisEnd"], 720);
        let dir = snapshot(&[(graph_key(), Some(envelope(&hex(GRAPH))))]);
        let file = dir.path().join("000002.log");
        let original = fs::read(&file).unwrap();
        let mut damaged = original.clone();
        *damaged.last_mut().unwrap() ^= 1;
        fs::write(&file, damaged).unwrap();
        assert!(matches!(
            read_snapshot(dir.path()),
            Err(ImportError::Corrupt("checksum-mismatch"))
        ));
        fs::write(&file, &original[..original.len() - 1]).unwrap();
        assert!(read_snapshot(dir.path()).is_err());
        let dir = snapshot(&[(graph_key(), Some(envelope(&hex(GRAPH))))]);
        fs::write(
            dir.path().join("000003.log"),
            batch(200, &[(graph_key(), None)]),
        )
        .unwrap();
        assert!(extract(dir.path()).unwrap()["graph"].is_null());
    }

    #[test]
    fn active_manifest_table_wal_and_crc() {
        let dir = snapshot(&[]);
        let data = sstable(&[(graph_key(), 50, Some(envelope(&hex(GRAPH))))]);
        fs::write(dir.path().join("000003.ldb"), &data).unwrap();
        let manifest = dir.path().join("MANIFEST-000001");
        let mut add = vec![7, 0, 3];
        add.extend(varint(data.len() as u64));
        add.extend(blob(b"a"));
        add.extend(blob(b"z"));
        let mut bytes = fs::read(&manifest).unwrap();
        bytes.extend(log(&add));
        fs::write(&manifest, bytes).unwrap();
        assert_eq!(extract(dir.path()).unwrap()["graph"]["yAxisEnd"], 250);
        let mut damaged = data.clone();
        damaged[5] ^= 1;
        fs::write(dir.path().join("000003.ldb"), damaged).unwrap();
        assert!(matches!(
            read_snapshot(dir.path()),
            Err(ImportError::Corrupt("checksum-mismatch"))
        ));
    }

    #[test]
    fn scopes_versions_recovery_and_tombstones() {
        let version = b"\x08\x01".to_vec();
        let dir = snapshot(&[
            (vec![0, 0, 0, 0, 0x32, 0], Some(version)),
            (graph_key(), Some(envelope(&hex(GRAPH)))),
        ]);
        assert_eq!(extract(dir.path()).unwrap()["graph"]["yAxisStart"], 50);
        let dir = snapshot(&[
            (vec![0, 0, 0, 0, 0x32, 1, 7], Some(vec![1])),
            (graph_key(), Some(envelope(&hex(GRAPH)))),
        ]);
        assert!(matches!(
            extract(dir.path()),
            Err(ImportError::Unsupported("database-recovery-required"))
        ));
        let dir = snapshot(&[
            (vec![0, 0, 0, 0, 0x32, 1, 7], None),
            (graph_key(), Some(envelope(&hex(GRAPH)))),
        ]);
        assert_eq!(extract(dir.path()).unwrap()["graph"]["yAxisStart"], 50);
        let dir = snapshot(&[(vec![0, 0, 0, 0, 0x32, 0], Some(2u64.to_le_bytes().to_vec()))]);
        assert!(matches!(
            extract(dir.path()),
            Err(ImportError::Unsupported("scopes-version"))
        ));
    }

    #[test]
    fn malformed_inputs_never_panic() {
        let bases = [
            envelope(&hex(UNICODE)),
            b"\x06\x00a\x12\x01\x00".to_vec(),
            log(b"record"),
            vec![0; 64],
        ];
        for base in bases {
            for index in 0..=base.len() {
                let mut mutated = base[..index].to_vec();
                if let Some(last) = mutated.last_mut() {
                    *last ^= 0xa5;
                }
                assert!(std::panic::catch_unwind(|| {
                    let _ = value(&mutated);
                    let _ = snappy(&mutated);
                    let _ = log_records(&mutated);
                    let _ = entries(&mutated);
                    let _ = table(&mutated);
                })
                .is_ok());
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn scanner_fixture(home: &Path) -> std::path::PathBuf {
        let source =
            home.join("Library/Application Support/Firescope/IndexedDB/file__0.indexeddb.leveldb");
        fs::create_dir_all(&source).unwrap();
        let fixture = snapshot(&[(graph_key(), Some(envelope(&hex(GRAPH))))]);
        for entry in fs::read_dir(fixture.path()).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), source.join(entry.file_name())).unwrap();
        }
        source
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn scanner_preserves_source_and_rejects_symlinks_and_size_limits() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let source = scanner_fixture(home.path());
        let contents = |path: &Path| -> BTreeMap<_, _> {
            fs::read_dir(path)
                .unwrap()
                .map(|e| {
                    let e = e.unwrap();
                    (e.file_name(), fs::read(e.path()).unwrap())
                })
                .collect()
        };
        let before = contents(&source);
        assert_eq!(scan(home.path())["status"], "found");
        assert_eq!(contents(&source), before);

        let linked_home = tempfile::tempdir().unwrap();
        let parent = linked_home
            .path()
            .join("Library/Application Support/Firescope/IndexedDB");
        fs::create_dir_all(&parent).unwrap();
        symlink(&source, parent.join("file__0.indexeddb.leveldb")).unwrap();
        assert_eq!(scan(linked_home.path())["reason"], "database-files");

        let oversized_home = tempfile::tempdir().unwrap();
        let oversized = scanner_fixture(oversized_home.path());
        fs::File::create(oversized.join("oversized"))
            .unwrap()
            .set_len(LIMIT as u64 + 1)
            .unwrap();
        assert_eq!(scan(oversized_home.path())["reason"], "size-limit");

        let total_home = tempfile::tempdir().unwrap();
        let total = scanner_fixture(total_home.path());
        for n in 0..5 {
            fs::File::create(total.join(format!("large-{n}")))
                .unwrap()
                .set_len(27 * 1024 * 1024)
                .unwrap();
        }
        assert_eq!(scan(total_home.path())["reason"], "size-limit");
    }
}

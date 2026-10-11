use std::{cell::Cell, fmt, io::Cursor, path::Path, rc::Rc};

use plist::Value as PlistValue;
use serde::de::{self, Deserialize, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

use super::{empty, failure, process_running, read_stable, reject_symlinks, ImportError, Product};

const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;
const MAX_PLIST_DEPTH: usize = 64;
const MAX_PLIST_NODES: usize = 100_000;

struct PlistPreflight;

struct PlistSeed {
    depth: usize,
    nodes: Rc<Cell<usize>>,
}

impl<'de> Deserialize<'de> for PlistPreflight {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        PlistSeed {
            depth: 0,
            nodes: Rc::new(Cell::new(0)),
        }
        .deserialize(deserializer)
    }
}

impl<'de> DeserializeSeed<'de> for PlistSeed {
    type Value = PlistPreflight;

    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        if self.depth > MAX_PLIST_DEPTH {
            return Err(de::Error::custom("plist nesting limit"));
        }
        let nodes = self.nodes.get() + 1;
        if nodes > MAX_PLIST_NODES {
            return Err(de::Error::custom("plist node limit"));
        }
        self.nodes.set(nodes);
        deserializer.deserialize_any(PlistVisitor(self))
    }
}

struct PlistVisitor(PlistSeed);

impl<'de> Visitor<'de> for PlistVisitor {
    type Value = PlistPreflight;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("bounded plist value")
    }

    fn visit_bool<E>(self, _: bool) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_i64<E>(self, _: i64) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_u64<E>(self, _: u64) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_f64<E>(self, _: f64) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_str<E>(self, _: &str) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_string<E>(self, _: String) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_bytes<E>(self, _: &[u8]) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_byte_buf<E>(self, _: Vec<u8>) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }
    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(PlistPreflight)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        while sequence
            .next_element_seed(PlistSeed {
                depth: self.0.depth + 1,
                nodes: Rc::clone(&self.0.nodes),
            })?
            .is_some()
        {}
        Ok(PlistPreflight)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Self::Value, A::Error> {
        while object.next_key::<String>()?.is_some() {
            object.next_value_seed(PlistSeed {
                depth: self.0.depth + 1,
                nodes: Rc::clone(&self.0.nodes),
            })?;
        }
        Ok(PlistPreflight)
    }
}

fn sanitize(value: &PlistValue) -> Value {
    match value {
        PlistValue::Boolean(value) => Value::Bool(*value),
        PlistValue::String(value) => Value::String(value.clone()),
        PlistValue::Integer(value) => value
            .as_signed()
            .map(Into::into)
            .or_else(|| value.as_unsigned().map(Into::into))
            .unwrap_or(Value::Null),
        PlistValue::Real(value) if value.is_finite() => serde_json::Number::from_f64(*value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        PlistValue::Array(values) => Value::Array(values.iter().map(sanitize).collect()),
        _ => Value::Null,
    }
}

pub(super) fn extract(data: &[u8]) -> Result<Value, ImportError> {
    plist::from_reader::<_, PlistPreflight>(Cursor::new(data))
        .map_err(|_| ImportError::Corrupt("settings-unreadable"))?;
    let raw = PlistValue::from_reader(Cursor::new(data))
        .map_err(|_| ImportError::Corrupt("settings-unreadable"))?;
    let raw = raw
        .as_dictionary()
        .ok_or(ImportError::Corrupt("settings-unreadable"))?;
    let mut settings = Map::new();

    for key in ["Mode", "BTfunction", "ETfunction", "ChannelTares"] {
        if let Some(value) = raw.get(key) {
            settings.insert(key.into(), sanitize(value));
        }
    }

    for (group, keys) in [
        ("Device", &["id"][..]),
        ("ExtraDev", &["extradevices"][..]),
        (
            "S7",
            &[
                "host", "port", "rack", "slot", "area", "db_nr", "start", "type", "mode", "div",
            ][..],
        ),
        (
            "Axis",
            &["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"][..],
        ),
    ] {
        for key in keys {
            if let Some(value) = raw.get(&format!("{group}.{key}")) {
                settings.insert(format!("{group}/{key}"), sanitize(value));
            }
        }
    }

    let modbus_fields = [
        "deviceId",
        "slave",
        "register",
        "float",
        "bcd",
        "code",
        "div",
        "mode",
        "FloatsAsInt",
        "BCDsAsInt",
        "Signed",
    ];
    for key in [
        "type",
        "comport",
        "baudrate",
        "bytesize",
        "parity",
        "stopbits",
        "host",
        "port",
        "wordorderLittle",
    ] {
        if let Some(value) = raw.get(&format!("Modbus.{key}")) {
            settings.insert(format!("Modbus/{key}"), sanitize(value));
        }
    }
    for channel in [1, 2] {
        for field in modbus_fields {
            let key = format!("input{channel}{field}");
            if let Some(value) = raw.get(&format!("Modbus.{key}")) {
                settings.insert(format!("Modbus/{key}"), sanitize(value));
            }
        }
    }

    if let Some(colors) = raw.get("Colors") {
        let value = colors.as_dictionary().map_or(Value::Null, |colors| {
            let mut allowed = Map::new();
            for key in ["bt", "et", "deltabt", "deltaet"] {
                if let Some(value) = colors.get(key) {
                    allowed.insert(key.into(), sanitize(value));
                }
            }
            Value::Object(allowed)
        });
        settings.insert("Colors".into(), value);
    }

    let version = raw
        .get("System.artisan_version")
        .and_then(PlistValue::as_string)
        .map(str::to_owned);
    Ok(serde_json::json!({
        "status": "found",
        "source": {"product": "Artisan", "version": version, "sourceId": "native"},
        "settings": settings,
    }))
}

pub(super) fn scan(home: &Path) -> Value {
    if !cfg!(target_os = "macos") {
        return empty(Product::Artisan, "unsupported", Some("platform"));
    }
    scan_macos(home).unwrap_or_else(|error| failure(Product::Artisan, error))
}

fn scan_macos(home: &Path) -> Result<Value, ImportError> {
    let path = home.join("Library/Preferences/org.artisan-scope.Artisan.plist");
    let before = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty(
                Product::Artisan,
                "not-found",
                Some("settings-not-found"),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    reject_symlinks(home, &path).map_err(|error| match error {
        ImportError::Unsupported(_) => ImportError::Unsupported("settings-file"),
        error => error,
    })?;
    if !before.file_type().is_file() || before.len() > MAX_FILE_SIZE {
        return Err(ImportError::Unsupported("settings-file"));
    }
    if process_running(&["-x", "Artisan"])? {
        return Ok(empty(
            Product::Artisan,
            "needs-app-closed",
            Some("app-running"),
        ));
    }
    let fingerprint = super::identity(&before);
    let data = read_stable(&path, &fingerprint, MAX_FILE_SIZE).map_err(|error| match error {
        ImportError::Unsupported(_) => ImportError::Unsupported("settings-file"),
        error => error,
    })?;
    if process_running(&["-x", "Artisan"])? {
        return Err(ImportError::Changed);
    }
    extract(&data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use plist::{Dictionary, Value as P};

    fn encoded(values: Dictionary, binary: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        if binary {
            P::Dictionary(values).to_writer_binary(&mut bytes).unwrap();
        } else {
            P::Dictionary(values).to_writer_xml(&mut bytes).unwrap();
        }
        bytes
    }

    fn full_settings() -> Dictionary {
        let mut colors = Dictionary::new();
        colors.insert("bt".into(), P::String("#112233".into()));
        colors.insert("et".into(), P::String("#445566".into()));
        colors.insert("canvas".into(), P::String("private".into()));
        let mut raw = Dictionary::new();
        for (key, value) in [
            ("Mode", P::String("C".into())),
            ("Device.id", P::Integer(29.into())),
            (
                "ExtraDev.extradevices",
                P::Array(vec![P::Integer(33.into())]),
            ),
            ("Modbus.type", P::Integer(0.into())),
            ("Modbus.input1register", P::Integer(1000.into())),
            ("Modbus.input1Signed", P::Boolean(false)),
            ("Modbus.input2div", P::Integer(0.into())),
            ("Modbus.input8deviceId", P::Integer(8.into())),
            (
                "S7.area",
                P::Array(vec![P::Integer(0.into()), P::Integer(1.into())]),
            ),
            ("Axis.xmin", P::Integer(0.into())),
            ("Colors", P::Dictionary(colors)),
            ("BTfunction", P::String(String::new())),
            (
                "ChannelTares",
                P::Array(vec![P::Integer(0.into()), P::Real(1.5)]),
            ),
            ("System.artisan_version", P::String("4.8.0".into())),
            (
                "recentFileList",
                P::Array(vec![P::String("/private/roast.alog".into())]),
            ),
            ("RoastHubs.token", P::String("secret".into())),
        ] {
            raw.insert(key.into(), value);
        }
        raw
    }

    #[test]
    fn extracts_allowlisted_native_settings() {
        let mut raw = Dictionary::new();
        raw.insert("Mode".into(), P::String("C".into()));
        raw.insert("Device.id".into(), P::Integer(29.into()));
        raw.insert("Modbus.input1register".into(), P::Integer(1000.into()));
        raw.insert("Modbus.input1float".into(), P::Data(b"QVariant".to_vec()));
        raw.insert("Modbus.input8deviceId".into(), P::Integer(8.into()));
        raw.insert("System.artisan_version".into(), P::String("4.8.0".into()));
        raw.insert("RoastHubs.token".into(), P::String("secret".into()));
        let mut bytes = Vec::new();
        P::Dictionary(raw).to_writer_binary(&mut bytes).unwrap();

        let result = extract(&bytes).unwrap();
        assert_eq!(result["settings"]["Device/id"], 29);
        assert_eq!(result["settings"]["Modbus/input1float"], Value::Null);
        assert!(result["settings"].get("Modbus/input8deviceId").is_none());
        assert!(result["settings"].get("RoastHubs.token").is_none());
        assert_eq!(result["source"]["version"], "4.8.0");
    }

    #[test]
    fn does_not_infer_version() {
        let mut raw = Dictionary::new();
        raw.insert("artisan_version".into(), P::String("9.0".into()));
        let mut bytes = Vec::new();
        P::Dictionary(raw).to_writer_xml(&mut bytes).unwrap();
        assert_eq!(extract(&bytes).unwrap()["source"]["version"], Value::Null);
    }

    #[test]
    fn rejects_malformed_and_non_dictionary_plists() {
        assert!(extract(b"not a plist").is_err());
        let mut bytes = Vec::new();
        P::Array(Vec::new()).to_writer_xml(&mut bytes).unwrap();
        assert!(extract(&bytes).is_err());
    }

    #[test]
    fn binary_and_xml_preserve_qsettings_values_and_bounds() {
        for binary in [false, true] {
            let result = extract(&encoded(full_settings(), binary)).unwrap();
            assert_eq!(
                result["source"],
                serde_json::json!({"product":"Artisan","version":"4.8.0","sourceId":"native"})
            );
            assert_eq!(result["settings"]["Modbus/input1Signed"], false);
            assert_eq!(result["settings"]["Modbus/input2div"], 0);
            assert_eq!(
                result["settings"]["ExtraDev/extradevices"],
                serde_json::json!([33])
            );
            assert_eq!(result["settings"]["S7/area"], serde_json::json!([0, 1]));
            assert_eq!(
                result["settings"]["ChannelTares"],
                serde_json::json!([0, 1.5])
            );
            assert_eq!(
                result["settings"]["Colors"],
                serde_json::json!({"bt":"#112233","et":"#445566"})
            );
            assert!(result["settings"].get("Modbus/input8deviceId").is_none());
            assert!(result["settings"].get("recentFileList").is_none());
            assert!(result["settings"].get("RoastHubs/token").is_none());
        }
    }

    #[test]
    fn unsupported_types_are_null_and_nested_arrays_are_sanitized() {
        let mut private = Dictionary::new();
        private.insert("token".into(), P::String("secret".into()));
        let mut raw = full_settings();
        raw.insert("Mode".into(), P::Dictionary(private));
        raw.insert("BTfunction".into(), P::Data(vec![1, 2]));
        raw.insert(
            "ChannelTares".into(),
            P::Array(vec![P::Boolean(false), P::Data(vec![1])]),
        );
        raw.insert("System.artisan_version".into(), P::Integer(4.into()));
        let result = extract(&encoded(raw, true)).unwrap();
        assert_eq!(result["settings"]["Mode"], Value::Null);
        assert_eq!(result["settings"]["BTfunction"], Value::Null);
        assert_eq!(
            result["settings"]["ChannelTares"],
            serde_json::json!([false, null])
        );
        assert_eq!(result["source"]["version"], Value::Null);
    }

    #[test]
    fn only_modbus_channels_one_and_two_are_imported() {
        let mut raw = Dictionary::new();
        raw.insert("Modbus.input1deviceId".into(), P::Integer(1.into()));
        raw.insert("Modbus.input2deviceId".into(), P::Integer(2.into()));
        raw.insert("Modbus.input3deviceId".into(), P::Integer(3.into()));
        let settings = extract(&encoded(raw, false)).unwrap()["settings"].clone();
        assert_eq!(settings["Modbus/input1deviceId"], 1);
        assert_eq!(settings["Modbus/input2deviceId"], 2);
        assert!(settings.get("Modbus/input3deviceId").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn scanner_preserves_source_and_rejects_size_and_symlink() {
        use std::os::unix::fs::symlink;

        let home = tempfile::tempdir().unwrap();
        let preferences = home.path().join("Library/Preferences");
        std::fs::create_dir_all(&preferences).unwrap();
        let source = preferences.join("org.artisan-scope.Artisan.plist");
        let original = encoded(full_settings(), true);
        std::fs::write(&source, &original).unwrap();
        assert_eq!(scan_macos(home.path()).unwrap()["status"], "found");
        assert_eq!(std::fs::read(&source).unwrap(), original);

        std::fs::write(&source, vec![b'x'; MAX_FILE_SIZE as usize + 1]).unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Unsupported("settings-file"))
        );
        std::fs::remove_file(&source).unwrap();
        let target = preferences.join("target.plist");
        std::fs::write(&target, encoded(full_settings(), true)).unwrap();
        symlink(&target, &source).unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Unsupported("settings-file"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn scanner_reports_missing_and_malformed_settings() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            scan_macos(home.path()).unwrap(),
            empty(Product::Artisan, "not-found", Some("settings-not-found"))
        );
        let preferences = home.path().join("Library/Preferences");
        std::fs::create_dir_all(&preferences).unwrap();
        std::fs::write(
            preferences.join("org.artisan-scope.Artisan.plist"),
            b"not a plist",
        )
        .unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Corrupt("settings-unreadable"))
        );
    }

    #[test]
    fn rejects_deep_xml_and_binary_before_value_materialization() {
        let mut xml =
            String::from(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>Mode</key>"#);
        for _ in 0..=MAX_PLIST_DEPTH {
            xml.push_str("<array>");
        }
        xml.push_str("<string>C</string>");
        for _ in 0..=MAX_PLIST_DEPTH {
            xml.push_str("</array>");
        }
        xml.push_str("</dict></plist>");
        assert_eq!(
            extract(xml.as_bytes()),
            Err(ImportError::Corrupt("settings-unreadable"))
        );

        let mut nested = P::String("C".into());
        for _ in 0..=MAX_PLIST_DEPTH {
            nested = P::Array(vec![nested]);
        }
        let mut raw = Dictionary::new();
        raw.insert("Mode".into(), nested);
        assert_eq!(
            extract(&encoded(raw, true)),
            Err(ImportError::Corrupt("settings-unreadable"))
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn scanner_rejects_non_macos_platforms() {
        assert_eq!(
            scan(Path::new("unused")),
            empty(Product::Artisan, "unsupported", Some("platform"))
        );
    }
}

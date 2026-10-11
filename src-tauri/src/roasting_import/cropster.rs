use std::{collections::HashSet, fmt, path::Path};

use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

use super::{empty, failure, process_running, read_stable, reject_symlinks, ImportError, Product};

const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;

struct JsonValue;

impl<'de> DeserializeSeed<'de> for JsonValue {
    type Value = Value;

    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        deserializer.deserialize_any(JsonVisitor)
    }
}

struct JsonVisitor;

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite number"))
    }
    fn visit_str<E>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.into()))
    }
    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }
    fn visit_none<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(JsonValue)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Value, A::Error> {
        let mut keys = HashSet::new();
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if !keys.insert(key.clone()) {
                return Err(de::Error::custom("duplicate-key"));
            }
            values.insert(key, object.next_value_seed(JsonValue)?);
        }
        Ok(Value::Object(values))
    }
}

fn parse(data: &[u8]) -> Result<Map<String, Value>, ImportError> {
    let mut deserializer = serde_json::Deserializer::from_slice(data);
    let value = JsonValue
        .deserialize(&mut deserializer)
        .map_err(|_| ImportError::Corrupt("settings-unreadable"))?;
    deserializer
        .end()
        .map_err(|_| ImportError::Corrupt("settings-unreadable"))?;
    value
        .as_object()
        .cloned()
        .ok_or(ImportError::Corrupt("settings-unreadable"))
}

fn sanitize_value(item: &Value) -> Value {
    match item {
        Value::Null | Value::Bool(_) | Value::String(_) | Value::Number(_) => item.clone(),
        Value::Array(values) => Value::Array(values.iter().map(sanitize_value).collect()),
        Value::Object(_) => Value::Null,
    }
}

fn source_value(value: &Value) -> Value {
    match value {
        Value::Null | Value::String(_) => value.clone(),
        _ => Value::Null,
    }
}

fn filtered(raw: &Map<String, Value>, keys: &[&str]) -> Map<String, Value> {
    keys.iter()
        .filter_map(|key| {
            raw.get(*key)
                .map(|item| ((*key).into(), sanitize_value(item)))
        })
        .collect()
}

fn preferences(raw: &Map<String, Value>) -> Value {
    let mut result = filtered(
        raw,
        &[
            "temperatureUnit",
            "time",
            "minTemp",
            "maxTemp",
            "minRiseRate",
            "maxRiseRate",
            "ror",
            "rorSmoothing",
            "autoDetectionEnabled",
            "autoStartEnabled",
            "startThreshold",
            "endThreshold",
        ],
    );
    if let Some(version) = raw.get("version") {
        result.insert("version".into(), sanitize_value(version));
    }
    Value::Object(result)
}

fn machine(raw: &Map<String, Value>) -> Value {
    let mut result = Map::new();
    for key in ["version", "selectedMachineId"] {
        if let Some(item) = raw.get(key) {
            result.insert(key.into(), sanitize_value(item));
        }
    }
    if let Some(sources) = raw.get("sources") {
        let sources = sources.as_object().map_or(Value::Null, |sources| {
            let mut result = Map::new();
            for (name, source) in sources {
                let fields: &[&str] = match name.as_str() {
                    "GenericModbusRtuSourceFactory" => &[
                        "temperatureUnit",
                        "bigEndian",
                        "storageFormatTemperature",
                        "filter",
                        "serialPort",
                        "encoding",
                        "baudRate",
                        "dataBits",
                        "parity",
                        "stopBits",
                        "modbusFunction",
                        "beanTemperatureSlave",
                        "beanTemperatureRegister",
                        "exhaustTemperatureSlave",
                        "exhaustTemperatureRegister",
                    ],
                    "GenericModbusTcpSourceFactory" => &[
                        "temperatureUnit",
                        "bigEndian",
                        "storageFormatTemperature",
                        "filter",
                        "host",
                        "port",
                        "beanTemperatureRegister",
                        "exhaustTemperatureRegister",
                    ],
                    _ => &[],
                };
                let filtered = source.as_object().map_or_else(Map::new, |source| {
                    fields
                        .iter()
                        .filter_map(|field| {
                            source
                                .get(*field)
                                .map(|item| ((*field).into(), source_value(item)))
                        })
                        .collect()
                });
                result.insert(name.clone(), Value::Object(filtered));
            }
            Value::Object(result)
        });
        result.insert("sources".into(), sources);
    }
    if let Some(channels) = raw.get("channels") {
        let channels = channels.as_array().map_or(Value::Null, |channels| {
            Value::Array(
                channels
                    .iter()
                    .filter_map(Value::as_object)
                    .map(|channel| {
                        Value::Object(filtered(
                            channel,
                            &[
                                "name",
                                "sourceFactory",
                                "index",
                                "type",
                                "visibility",
                                "offset",
                                "ror",
                                "color",
                                "primary",
                            ],
                        ))
                    })
                    .collect(),
            )
        });
        result.insert("channels".into(), channels);
    }
    Value::Object(result)
}

pub(super) fn extract(
    machine_data: Option<&[u8]>,
    preferences_data: Option<&[u8]>,
) -> Result<Value, ImportError> {
    let machine_raw = machine_data.map(parse).transpose()?;
    let preferences_raw = preferences_data.map(parse).transpose()?;
    let versions: HashSet<&str> = [&machine_raw, &preferences_raw]
        .into_iter()
        .flatten()
        .filter_map(|raw| raw.get("version").and_then(Value::as_str))
        .collect();
    if versions.len() > 1 {
        return Err(ImportError::Corrupt("settings-version-mismatch"));
    }
    let version = versions.into_iter().next();
    Ok(serde_json::json!({
        "status": "found",
        "source": {"product": "Cropster", "version": version, "sourceId": "default"},
        "machine": machine_raw.as_ref().map(machine),
        "preferences": preferences_raw.as_ref().map(preferences),
    }))
}

pub(super) fn scan(home: &Path) -> Value {
    if !cfg!(target_os = "macos") {
        return empty(Product::Cropster, "unsupported", Some("platform"));
    }
    scan_macos(home).unwrap_or_else(|error| failure(Product::Cropster, error))
}

fn scan_macos(home: &Path) -> Result<Value, ImportError> {
    let directory = home.join("CropsterRoastingIntelligence/default");
    reject_symlinks(home, &directory)?;
    let paths = [
        directory.join("machine.json"),
        directory.join("preferences.json"),
    ];
    let mut files = Vec::new();
    for path in &paths {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_file() && metadata.len() <= MAX_FILE_SIZE => {
                files.push(Some((super::identity(&metadata), path)))
            }
            Ok(_) => return Err(ImportError::Unsupported("settings-files")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => files.push(None),
            Err(error) => return Err(error.into()),
        }
    }
    if files.iter().all(Option::is_none) {
        return Ok(empty(
            Product::Cropster,
            "not-found",
            Some("settings-not-found"),
        ));
    }
    if running()? {
        return Ok(empty(
            Product::Cropster,
            "needs-app-closed",
            Some("app-running"),
        ));
    }
    let mut data = Vec::new();
    for file in &files {
        data.push(match file {
            Some((fingerprint, path)) => Some(
                read_stable(path, fingerprint, MAX_FILE_SIZE).map_err(|error| match error {
                    ImportError::Unsupported(_) => ImportError::Unsupported("settings-files"),
                    error => error,
                })?,
            ),
            None => None,
        });
    }
    for (path, original) in paths.iter().zip(&files) {
        match (std::fs::symlink_metadata(path), original) {
            (Err(error), None) if error.kind() == std::io::ErrorKind::NotFound => {}
            (Ok(current), Some((fingerprint, _))) if super::identity(&current) == *fingerprint => {}
            _ => return Err(ImportError::Changed),
        }
    }
    if running()? {
        return Err(ImportError::Changed);
    }
    match extract(data[0].as_deref(), data[1].as_deref()) {
        Err(ImportError::Corrupt("settings-version-mismatch")) => Ok(empty(
            Product::Cropster,
            "unreadable",
            Some("settings-version-mismatch"),
        )),
        result => result,
    }
}

fn running() -> Result<bool, ImportError> {
    Ok(process_running(&["-x", "Cropster Roasting Intelligence|Roasting Intelligence|roastingintelligence|RoastingIntelligence"])?
        || process_running(&["-f", "[o]rg.cropster.roastingintelligence.RoastingIntelligenceApp|[c]om.cropster.roastingintelligence.Launcher"])? )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_credentials_and_preserves_values() {
        let machine = br#"{"version":"5.13","selectedMachineId":"m1","sources":{"GenericModbusRtuSourceFactory":{"serialPort":"/dev/cu.usbserial","bigEndian":"false","password":"secret"},"PrivateCloudSource":{"token":"secret"}},"channels":[{"name":"beanTemperature","index":0,"primary":false,"secret":"x"}],"states":[{"control":"burner"}]}"#;
        let result = extract(Some(machine), None).unwrap();
        assert_eq!(
            result["machine"]["sources"]["GenericModbusRtuSourceFactory"]["bigEndian"],
            "false"
        );
        assert!(
            result["machine"]["sources"]["GenericModbusRtuSourceFactory"]
                .get("password")
                .is_none()
        );
        assert_eq!(
            result["machine"]["sources"]["PrivateCloudSource"],
            serde_json::json!({})
        );
        assert_eq!(result["machine"]["channels"][0]["primary"], false);
        assert!(result["machine"].get("states").is_none());
    }

    #[test]
    fn rejects_recursive_duplicates_and_version_conflicts() {
        assert!(extract(Some(br#"{"sources":{"x":{"token":1,"token":2}}}"#), None).is_err());
        assert!(extract(Some(br#"{"version":"1"}"#), Some(br#"{"version":"2"}"#)).is_err());
    }

    #[test]
    fn rejects_non_object_documents() {
        assert!(extract(Some(b"[]"), None).is_err());
    }

    #[test]
    fn extracts_exact_machine_and_preference_schema() {
        let machine = br#"{"version":"5.13","selectedMachineId":"m1","sources":{"GenericModbusRtuSourceFactory":{"serialPort":"/dev/cu.usbserial","baudRate":"19200","bigEndian":"false","password":"secret"},"PrivateCloudSource":{"token":"secret"}},"channels":[{"name":"beanTemperature","index":0,"visibility":["STATUS","CHART"],"offset":0,"primary":false,"secret":"x"},{"name":"privateChannel","index":9}],"states":[{"control":"burner"}]}"#;
        let preferences = br#"{"version":"5.13","temperatureUnit":"CELSIUS","minTemp":0,"autoDetectionEnabled":false,"username":"private@example.com"}"#;
        let result = extract(Some(machine), Some(preferences)).unwrap();
        assert_eq!(
            result["source"],
            serde_json::json!({"product":"Cropster","version":"5.13","sourceId":"default"})
        );
        assert_eq!(result["machine"]["selectedMachineId"], "m1");
        assert_eq!(
            result["machine"]["sources"]["GenericModbusRtuSourceFactory"],
            serde_json::json!({"serialPort":"/dev/cu.usbserial","baudRate":"19200","bigEndian":"false"})
        );
        assert_eq!(
            result["machine"]["sources"]["PrivateCloudSource"],
            serde_json::json!({})
        );
        assert_eq!(
            result["machine"]["channels"],
            serde_json::json!([
                {"name":"beanTemperature","index":0,"visibility":["STATUS","CHART"],"offset":0,"primary":false},
                {"name":"privateChannel","index":9}
            ])
        );
        assert_eq!(
            result["preferences"],
            serde_json::json!({"version":"5.13","temperatureUnit":"CELSIUS","minTemp":0,"autoDetectionEnabled":false})
        );
    }

    #[test]
    fn missing_documents_and_versions_keep_null_fields() {
        let machine_only = extract(Some(br#"{"selectedMachineId":"m1"}"#), None).unwrap();
        assert_eq!(machine_only["source"]["version"], Value::Null);
        assert_eq!(machine_only["preferences"], Value::Null);
        let preferences_only = extract(None, Some(br#"{"temperatureUnit":"CELSIUS"}"#)).unwrap();
        assert_eq!(preferences_only["machine"], Value::Null);
        assert_eq!(preferences_only["source"]["version"], Value::Null);
        assert_eq!(
            preferences_only["preferences"]["temperatureUnit"],
            "CELSIUS"
        );
        let neither = extract(None, None).unwrap();
        assert_eq!(neither["machine"], Value::Null);
        assert_eq!(neither["preferences"], Value::Null);
    }

    #[test]
    fn sanitizes_types_without_exposing_object_values() {
        let machine = br#"{"version":13,"selectedMachineId":{"secret":"x"},"sources":{"GenericModbusTcpSourceFactory":{"host":"localhost","port":502,"filter":false}},"channels":[null,3,{"name":{"secret":"x"},"visibility":["CHART",{"secret":"x"}],"offset":0}],"extra":"private"}"#;
        let preferences = br#"{"version":13,"temperatureUnit":{"secret":"x"},"time":[0,{"secret":"x"}],"extra":"private"}"#;
        let result = extract(Some(machine), Some(preferences)).unwrap();
        assert_eq!(result["source"]["version"], Value::Null);
        assert_eq!(result["machine"]["version"], 13);
        assert_eq!(result["machine"]["selectedMachineId"], Value::Null);
        assert_eq!(
            result["machine"]["sources"]["GenericModbusTcpSourceFactory"],
            serde_json::json!({"host":"localhost","port":null,"filter":null})
        );
        assert_eq!(
            result["machine"]["channels"],
            serde_json::json!([{"name":null,"visibility":["CHART",null],"offset":0}])
        );
        assert_eq!(result["preferences"]["temperatureUnit"], Value::Null);
        assert_eq!(result["preferences"]["time"], serde_json::json!([0, null]));
        assert!(result["preferences"].get("extra").is_none());
    }

    #[test]
    fn invalid_sources_and_channels_have_original_null_semantics() {
        let result = extract(Some(br#"{"sources":[],"channels":{}}"#), None).unwrap();
        assert_eq!(result["machine"]["sources"], Value::Null);
        assert_eq!(result["machine"]["channels"], Value::Null);
        let result = extract(Some(br#"{"sources":{"GenericModbusRtuSourceFactory":[],"unknown":null},"channels":[1,null]}"#), None).unwrap();
        assert_eq!(
            result["machine"]["sources"]["GenericModbusRtuSourceFactory"],
            serde_json::json!({})
        );
        assert_eq!(
            result["machine"]["sources"]["unknown"],
            serde_json::json!({})
        );
        assert_eq!(result["machine"]["channels"], serde_json::json!([]));
    }

    #[test]
    fn rejects_malformed_trailing_and_duplicates_at_every_depth() {
        for document in [
            &b"not json"[..],
            &b"{} {}"[..],
            &br#"{"version":"1","version":"2"}"#[..],
            &br#"{"sources":{"x":{"token":1,"token":2}}}"#[..],
            &br#"{"channels":[{"name":"a","name":"b"}]}"#[..],
        ] {
            assert!(extract(Some(document), None).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn scanner_preserves_sources_and_rejects_size_and_symlink() {
        use std::os::unix::fs::symlink;

        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("CropsterRoastingIntelligence/default");
        std::fs::create_dir_all(&directory).unwrap();
        let machine = directory.join("machine.json");
        let preferences = directory.join("preferences.json");
        let machine_data = br#"{"version":"5.13"}"#;
        let preferences_data = br#"{"version":"5.13"}"#;
        std::fs::write(&machine, machine_data).unwrap();
        std::fs::write(&preferences, preferences_data).unwrap();
        assert_eq!(scan_macos(home.path()).unwrap()["status"], "found");
        assert_eq!(std::fs::read(&machine).unwrap(), machine_data);
        assert_eq!(std::fs::read(&preferences).unwrap(), preferences_data);

        std::fs::write(&machine, vec![b'x'; MAX_FILE_SIZE as usize + 1]).unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Unsupported("settings-files"))
        );
        std::fs::remove_file(&machine).unwrap();
        let target = directory.join("target.json");
        std::fs::write(&target, b"{}").unwrap();
        symlink(&target, &machine).unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Unsupported("settings-files"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn scanner_reports_missing_malformed_and_version_conflict() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            scan_macos(home.path()).unwrap(),
            empty(Product::Cropster, "not-found", Some("settings-not-found"))
        );
        let directory = home.path().join("CropsterRoastingIntelligence/default");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("machine.json"), b"not json").unwrap();
        assert_eq!(
            scan_macos(home.path()),
            Err(ImportError::Corrupt("settings-unreadable"))
        );
        std::fs::write(directory.join("machine.json"), br#"{"version":"1"}"#).unwrap();
        std::fs::write(directory.join("preferences.json"), br#"{"version":"2"}"#).unwrap();
        assert_eq!(
            scan_macos(home.path()).unwrap(),
            empty(
                Product::Cropster,
                "unreadable",
                Some("settings-version-mismatch")
            )
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn scanner_rejects_non_macos_platforms() {
        assert_eq!(
            scan(Path::new("unused")),
            empty(Product::Cropster, "unsupported", Some("platform"))
        );
    }
}

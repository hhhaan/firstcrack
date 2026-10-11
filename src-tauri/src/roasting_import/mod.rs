mod artisan;
mod cropster;
mod firescope;

use serde_json::{json, Value};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Copy)]
pub(super) enum Product {
    Firescope,
    Artisan,
    Cropster,
}

#[derive(Debug, PartialEq)]
pub(super) enum ImportError {
    Unsupported(&'static str),
    Corrupt(&'static str),
    Changed,
    Io,
}

impl From<std::io::Error> for ImportError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

pub(super) fn empty(product: Product, status: &str, reason: Option<&str>) -> Value {
    let mut result = match product {
        Product::Firescope => json!({
            "status": status, "source": {"product": "Firescope", "version": null},
            "graphTemperatureUnit": null, "graph": null, "indicator": null, "global": null,
            "machines": []
        }),
        Product::Artisan => json!({
            "status": status,
            "source": {"product": "Artisan", "version": null, "sourceId": "native"},
            "settings": null
        }),
        Product::Cropster => json!({
            "status": status,
            "source": {"product": "Cropster", "version": null, "sourceId": "default"},
            "machine": null, "preferences": null
        }),
    };
    if let Some(reason) = reason {
        result["reason"] = reason.into();
    }
    result
}

pub(super) fn failure(product: Product, error: ImportError) -> Value {
    let database = matches!(product, Product::Firescope);
    match error {
        ImportError::Unsupported(reason) => empty(product, "unsupported", Some(reason)),
        ImportError::Changed => empty(
            product,
            "needs-app-closed",
            Some(if database {
                "database-changed"
            } else {
                "settings-changed"
            }),
        ),
        ImportError::Corrupt(_) | ImportError::Io => empty(
            product,
            "unreadable",
            Some(if database {
                "database-unreadable"
            } else {
                "settings-unreadable"
            }),
        ),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Fingerprint {
    length: u64,
    #[cfg(unix)]
    unix: (u64, u64, u32, i64, i64, i64, i64),
    #[cfg(not(unix))]
    times: (Option<std::time::SystemTime>, Option<std::time::SystemTime>),
}

pub(super) fn identity(metadata: &Metadata) -> Fingerprint {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Fingerprint {
        length: metadata.len(),
        #[cfg(unix)]
        unix: (
            metadata.dev(),
            metadata.ino(),
            metadata.mode(),
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec(),
        ),
        #[cfg(not(unix))]
        times: (metadata.modified().ok(), metadata.created().ok()),
    }
}

pub(super) fn open_read(path: &Path) -> Result<File, ImportError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(ImportError::Unsupported("settings-files"));
    }
    Ok(file)
}

pub(super) fn reject_symlinks(home: &Path, path: &Path) -> Result<(), ImportError> {
    for parent in path.ancestors().take_while(|parent| *parent != home) {
        match fs::symlink_metadata(parent) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(ImportError::Unsupported("settings-files"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(super) fn read_stable(
    path: &Path,
    before: &Fingerprint,
    limit: u64,
) -> Result<Vec<u8>, ImportError> {
    let mut file = open_read(path)?;
    if identity(&file.metadata()?) != *before {
        return Err(ImportError::Changed);
    }
    let mut data = Vec::new();
    file.by_ref().take(limit + 1).read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        return Err(ImportError::Unsupported("size-limit"));
    }
    if identity(&file.metadata()?) != *before {
        return Err(ImportError::Changed);
    }
    file.seek(SeekFrom::Start(0))?;
    let mut again = Vec::new();
    file.by_ref().take(limit + 1).read_to_end(&mut again)?;
    if data != again
        || identity(&file.metadata()?) != *before
        || identity(&fs::symlink_metadata(path)?) != *before
    {
        return Err(ImportError::Changed);
    }
    Ok(data)
}

pub(super) fn process_running(args: &[&str]) -> Result<bool, ImportError> {
    let mut child = Command::new("/usr/bin/pgrep")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait()? {
            return match status.code() {
                Some(0) => Ok(true),
                Some(1) => Ok(false),
                _ => Err(ImportError::Io),
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ImportError::Io);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(desktop)]
async fn read(app: tauri::AppHandle, product: Product) -> Result<Value, &'static str> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(empty(product, "unsupported", Some("platform")))
    }
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let home = match app.path().home_dir() {
            Ok(home) => home,
            Err(_) => return Ok(failure(product, ImportError::Io)),
        };
        tokio::time::timeout(Duration::from_secs(20), async move {
            let permit = SCANS[product as usize]
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| "settings-scan-failed")?;
            tauri::async_runtime::spawn_blocking(move || {
                // The worker keeps the permit after a caller times out.
                let _permit = permit;
                match product {
                    Product::Firescope => firescope::scan(&home),
                    Product::Artisan => artisan::scan(&home),
                    Product::Cropster => cropster::scan(&home),
                }
            })
            .await
            .map_err(|_| "settings-scan-failed")
        })
        .await
        .map_err(|_| "settings-scan-timeout")?
    }
}

#[cfg(all(desktop, target_os = "macos"))]
static SCANS: std::sync::LazyLock<[std::sync::Arc<tokio::sync::Semaphore>; 3]> =
    std::sync::LazyLock::new(|| {
        std::array::from_fn(|_| std::sync::Arc::new(tokio::sync::Semaphore::new(1)))
    });

#[cfg(desktop)]
#[tauri::command]
pub async fn read_firescope_settings(app: tauri::AppHandle) -> Result<Value, &'static str> {
    read(app, Product::Firescope).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn read_artisan_settings(app: tauri::AppHandle) -> Result<Value, &'static str> {
    read(app, Product::Artisan).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn read_cropster_settings(app: tauri::AppHandle) -> Result<Value, &'static str> {
    read(app, Product::Cropster).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_reads_preserve_source_and_reject_replacements() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings");
        fs::write(&path, b"original").unwrap();
        let before = identity(&fs::symlink_metadata(&path).unwrap());
        assert_eq!(read_stable(&path, &before, 64).unwrap(), b"original");
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::write(&path, b"modified").unwrap();
        assert_eq!(read_stable(&path, &before, 64), Err(ImportError::Changed));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_links_without_reading_the_target() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("link");
        std::os::unix::fs::symlink("private-target", &path).unwrap();
        assert!(open_read(&path).is_err());
        assert_eq!(
            reject_symlinks(directory.path(), &path),
            Err(ImportError::Unsupported("settings-files"))
        );
    }

    #[test]
    fn failures_have_only_public_status_and_reason() {
        let result = failure(Product::Firescope, ImportError::Corrupt("private-context"));
        assert_eq!(result["status"], "unreadable");
        assert!(!result.to_string().contains("private-context"));
        assert_eq!(
            failure(Product::Artisan, ImportError::Changed)["reason"],
            "settings-changed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn opening_a_replaced_fifo_does_not_block() {
        use std::os::unix::ffi::OsStrExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings");
        let name = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert_eq!(
            open_read(&path).unwrap_err(),
            ImportError::Unsupported("settings-files")
        );
    }
}

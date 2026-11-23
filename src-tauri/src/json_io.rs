use crate::services::notes::AppError;
use serde::Serialize;
use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = temporary_json_path(path);
    let mut temp_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)?;
    let result = (|| {
        serde_json::to_writer_pretty(&mut temp_file, value)?;
        temp_file.write_all(b"\n")?;
        temp_file.sync_all()?;
        drop(temp_file);
        fs::rename(&temp_path, path)?;
        sync_parent_dir(path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn temporary_json_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serialization_failure_keeps_original_and_cleans_temp_file() {
        struct Broken;
        impl Serialize for Broken {
            fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("intentional serialization failure"))
            }
        }
        let root = std::env::temp_dir().join(format!("json-failure-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("metadata.json");
        write_json_atomic(&target, &serde_json::json!({"original": true})).unwrap();
        let original = fs::read(&target).unwrap();
        assert!(write_json_atomic(&target, &Broken).is_err());
        assert_eq!(fs::read(&target).unwrap(), original);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_writes_leave_complete_json_and_no_temporary_files() {
        let root = std::env::temp_dir().join(format!("json-io-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("metadata.json");
        std::thread::scope(|scope| {
            for writer in 0..16 {
                let target = &target;
                scope.spawn(move || {
                    for iteration in 0..20 {
                        write_json_atomic(target, &serde_json::json!({"writer": writer, "iteration": iteration})).unwrap();
                    }
                });
            }
        });
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert!(value["writer"].is_number());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(not(target_os = "windows"))]
fn sync_parent_dir(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_parent_dir(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

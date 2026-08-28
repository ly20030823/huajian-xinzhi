use crate::services::notes::AppError;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

const GREETINGS_FILE: &str = "greetings.md";
const ABOUT_FILE: &str = "about.md";
const SYNC_GUIDE_FILE: &str = "sync-guide.md";
const README_FILE: &str = "README.md";

const DEFAULT_GREETINGS: &str = include_str!("../../customization/greetings.md");
const DEFAULT_ABOUT: &str = include_str!("../../customization/about.md");
const DEFAULT_SYNC_GUIDE: &str = include_str!("../../customization/sync-guide.md");
const DEFAULT_README: &str = include_str!("../../customization/README.md");

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomizationContent {
    pub greetings_markdown: String,
    pub about_markdown: String,
    pub sync_guide_markdown: String,
    pub directory: String,
}

fn io_error(error: impl ToString) -> AppError {
    AppError {
        code: "customizationIo".to_string(),
        message: error.to_string(),
        details: BTreeMap::new(),
    }
}

fn default_customization_dir() -> Result<PathBuf, AppError> {
    if let Some(path) = env::var_os("FLORAL_NOTEPAPER_CUSTOMIZATION_DIR") {
        return Ok(PathBuf::from(path));
    }

    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .map(|path| path.join("customization"))
            .ok_or_else(|| io_error("Unable to resolve the development customization directory"));
    }

    #[cfg(not(debug_assertions))]
    {
        let executable = env::current_exe().map_err(io_error)?;
        executable
            .parent()
            .map(|path| path.join("customization"))
            .ok_or_else(|| io_error("Unable to resolve the executable directory"))
    }
}

fn create_default_if_missing(path: &Path, content: &str) -> Result<(), AppError> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, content).map_err(io_error)
}

fn ensure_customization_files(directory: &Path) -> Result<(), AppError> {
    fs::create_dir_all(directory).map_err(io_error)?;
    create_default_if_missing(&directory.join(GREETINGS_FILE), DEFAULT_GREETINGS)?;
    create_default_if_missing(&directory.join(ABOUT_FILE), DEFAULT_ABOUT)?;
    create_default_if_missing(&directory.join(SYNC_GUIDE_FILE), DEFAULT_SYNC_GUIDE)?;
    create_default_if_missing(&directory.join(README_FILE), DEFAULT_README)?;
    Ok(())
}

pub fn load_customization() -> Result<CustomizationContent, AppError> {
    let directory = default_customization_dir()?;
    ensure_customization_files(&directory)?;

    let greetings_markdown =
        fs::read_to_string(directory.join(GREETINGS_FILE)).map_err(io_error)?;
    let about_markdown = fs::read_to_string(directory.join(ABOUT_FILE)).map_err(io_error)?;
    let sync_guide_markdown =
        fs::read_to_string(directory.join(SYNC_GUIDE_FILE)).map_err(io_error)?;

    Ok(CustomizationContent {
        greetings_markdown,
        about_markdown,
        sync_guide_markdown,
        directory: directory.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_directory() -> PathBuf {
        env::temp_dir().join(format!("floral-customization-{}", Uuid::new_v4()))
    }

    #[test]
    fn creates_all_default_files() {
        let directory = temp_directory();
        ensure_customization_files(&directory).expect("create customization defaults");

        assert_eq!(
            fs::read_to_string(directory.join(GREETINGS_FILE)).expect("read greetings"),
            DEFAULT_GREETINGS
        );
        assert_eq!(
            fs::read_to_string(directory.join(ABOUT_FILE)).expect("read about"),
            DEFAULT_ABOUT
        );
        assert!(directory.join(README_FILE).is_file());
        assert_eq!(
            fs::read_to_string(directory.join(SYNC_GUIDE_FILE)).expect("read sync guide"),
            DEFAULT_SYNC_GUIDE
        );

        fs::remove_dir_all(directory).expect("remove temporary customization directory");
    }

    #[test]
    fn preserves_existing_user_files() {
        let directory = temp_directory();
        fs::create_dir_all(&directory).expect("create temporary customization directory");
        fs::write(directory.join(GREETINGS_FILE), "- 自定义问候").expect("write custom greeting");

        ensure_customization_files(&directory).expect("ensure customization defaults");

        assert_eq!(
            fs::read_to_string(directory.join(GREETINGS_FILE)).expect("read custom greeting"),
            "- 自定义问候"
        );
        assert!(directory.join(ABOUT_FILE).is_file());

        fs::remove_dir_all(directory).expect("remove temporary customization directory");
    }
}

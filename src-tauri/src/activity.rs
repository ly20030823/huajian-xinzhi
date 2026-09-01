use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

/// Daily activity records deliberately live under `.floral-originals`.
/// The existing GitHub sync already keeps that hidden directory in sync, while
/// the notes index only scans Markdown documents. This keeps records out of
/// the sidebar without introducing a second cloud transport.
const ACTIVITY_DIR: &str = ".floral-originals/activity-log";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPeriod {
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    pub date: String,
    #[serde(default)]
    pub morning: ActivityPeriod,
    #[serde(default)]
    pub afternoon: ActivityPeriod,
    #[serde(default)]
    pub evening: ActivityPeriod,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveActivityRequest {
    pub date: String,
    #[serde(default)]
    pub morning: String,
    #[serde(default)]
    pub afternoon: String,
    #[serde(default)]
    pub evening: String,
}

pub fn get_day(date: String) -> Result<ActivityDay, AppError> {
    let store = default_store()?;
    prune_expired_for_data_dir(store.data_dir())?;
    load_day(store.data_dir(), parse_date(&date)?)
}

pub fn save_day(request: SaveActivityRequest) -> Result<ActivityDay, AppError> {
    let store = default_store()?;
    prune_expired_for_data_dir(store.data_dir())?;
    let date = parse_date(&request.date)?;
    let mut day = load_day(store.data_dir(), date)?;
    let now = Utc::now();
    update_period(&mut day.morning, request.morning, now);
    update_period(&mut day.afternoon, request.afternoon, now);
    update_period(&mut day.evening, request.evening, now);

    let path = day_path(store.data_dir(), date);
    if is_empty_day(&day) {
        if path.exists() {
            fs::remove_file(path)?;
        }
    } else {
        write_json_atomic(&path, &day)?;
    }
    Ok(day)
}

pub fn list_month(year: i32, month: u32) -> Result<Vec<ActivityDay>, AppError> {
    let date = first_day(year, month)?;
    let store = default_store()?;
    prune_expired_for_data_dir(store.data_dir())?;
    list_month_in_dir(store.data_dir(), date.year(), date.month())
}

pub fn month_report(year: i32, month: u32) -> Result<String, AppError> {
    let days = list_month(year, month)?;
    let mut report = format!("# {year} 年 {month} 月工作记录\n");
    for day in days.into_iter().filter(|day| !is_empty_day(day)) {
        report.push_str(&format!("\n## {} 月 {} 日\n", month, day_of(&day.date)?.day()));
        append_report_period(&mut report, "上午", &day.morning.text);
        append_report_period(&mut report, "下午", &day.afternoon.text);
        append_report_period(&mut report, "晚上", &day.evening.text);
    }
    Ok(report)
}

pub fn prune_expired_for_data_dir(data_dir: &Path) -> Result<(), AppError> {
    prune_before(data_dir, retention_cutoff(Local::now().date_naive()))
}

fn prune_before(data_dir: &Path, cutoff: NaiveDate) -> Result<(), AppError> {
    let root = activity_dir(data_dir);
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(date) = file_date(&path) else { continue };
        if date < cutoff {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// Used by sync.rs to prevent an old cloud record from being restored on a
/// freshly connected device after the local retention window has elapsed.
pub fn is_expired_activity_repo_path(path: &str) -> bool {
    let Some(file_name) = activity_file_name_from_repo_path(path) else {
        return false;
    };
    if file_name.contains('/') {
        return false;
    }
    NaiveDate::parse_from_str(file_name.trim_end_matches(".json"), "%Y-%m-%d")
        .map(|date| date < retention_cutoff(Local::now().date_naive()))
        .unwrap_or(false)
}

pub fn is_activity_repo_path(path: &str) -> bool {
    activity_file_name_from_repo_path(path).is_some()
}

pub fn merge_sync_days(local_bytes: &[u8], remote_bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut local: ActivityDay = serde_json::from_slice(local_bytes)?;
    let remote: ActivityDay = serde_json::from_slice(remote_bytes)?;
    if local.date != remote.date {
        return Err(AppError::new("activitySync", "同步的每日记录日期不一致"));
    }
    local.morning = newer_period(&local.morning, &remote.morning);
    local.afternoon = newer_period(&local.afternoon, &remote.afternoon);
    local.evening = newer_period(&local.evening, &remote.evening);
    let mut bytes = serde_json::to_vec_pretty(&local)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn activity_file_name_from_repo_path(path: &str) -> Option<&str> {
    let marker = "/.floral-originals/activity-log/";
    let (_, file_name) = path.rsplit_once(marker)?;
    (!file_name.contains('/')).then_some(file_name)
}

fn activity_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(ACTIVITY_DIR)
}

fn day_path(data_dir: &Path, date: NaiveDate) -> PathBuf {
    activity_dir(data_dir).join(format!("{}.json", date.format("%Y-%m-%d")))
}

fn parse_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::new("activityDate", "日期格式应为 YYYY-MM-DD"))
}

fn day_of(value: &str) -> Result<NaiveDate, AppError> {
    parse_date(value)
}

fn first_day(year: i32, month: u32) -> Result<NaiveDate, AppError> {
    NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::new("activityMonth", "月份无效"))
}

fn load_day(data_dir: &Path, date: NaiveDate) -> Result<ActivityDay, AppError> {
    let path = day_path(data_dir, date);
    if !path.exists() {
        return Ok(ActivityDay { date: date.format("%Y-%m-%d").to_string(), ..Default::default() });
    }
    let mut day: ActivityDay = serde_json::from_slice(&fs::read(path)?)?;
    day.date = date.format("%Y-%m-%d").to_string();
    Ok(day)
}

fn list_month_in_dir(data_dir: &Path, year: i32, month: u32) -> Result<Vec<ActivityDay>, AppError> {
    let root = activity_dir(data_dir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut days = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let Some(date) = file_date(&path) else { continue };
        if date.year() == year && date.month() == month {
            days.push(load_day(data_dir, date)?);
        }
    }
    days.sort_by(|left, right| left.date.cmp(&right.date));
    Ok(days)
}

fn file_date(path: &Path) -> Option<NaiveDate> {
    let name = path.file_name()?.to_str()?;
    let stem = name.strip_suffix(".json")?;
    NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()
}

fn update_period(period: &mut ActivityPeriod, text: String, now: DateTime<Utc>) {
    let text = text.trim().to_string();
    if period.text != text {
        period.text = text;
        period.updated_at = Some(now);
    }
}

fn newer_period(left: &ActivityPeriod, right: &ActivityPeriod) -> ActivityPeriod {
    match (left.text.trim().is_empty(), right.text.trim().is_empty()) {
        (true, false) => right.clone(),
        (false, true) => left.clone(),
        (true, true) => left.clone(),
        (false, false) => match (left.updated_at, right.updated_at) {
            (Some(left_at), Some(right_at)) if right_at > left_at => right.clone(),
            _ => left.clone(),
        },
    }
}

fn is_empty_day(day: &ActivityDay) -> bool {
    day.morning.text.trim().is_empty()
        && day.afternoon.text.trim().is_empty()
        && day.evening.text.trim().is_empty()
}

fn append_report_period(report: &mut String, label: &str, text: &str) {
    let text = text.trim();
    if !text.is_empty() {
        report.push_str(&format!("- {label}：{text}\n"));
    }
}

fn retention_cutoff(today: NaiveDate) -> NaiveDate {
    let (year, month) = if today.month() == 1 {
        (today.year() - 1, 12)
    } else {
        (today.year(), today.month() - 1)
    };
    NaiveDate::from_ymd_opt(year, month, 1).expect("valid previous month")
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn retention_keeps_current_and_previous_calendar_month() {
        assert_eq!(retention_cutoff(NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()), NaiveDate::from_ymd_opt(2026, 8, 1).unwrap());
        assert_eq!(retention_cutoff(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
    }

    #[test]
    fn report_omits_empty_periods() {
        let day = ActivityDay { date: "2026-09-01".into(), morning: ActivityPeriod { text: "整理月报".into(), updated_at: None }, ..Default::default() };
        assert!(!is_empty_day(&day));
        let mut report = String::new();
        append_report_period(&mut report, "上午", &day.morning.text);
        append_report_period(&mut report, "下午", &day.afternoon.text);
        assert_eq!(report, "- 上午：整理月报\n");
    }

    #[test]
    fn pruning_removes_only_records_before_the_previous_month() {
        let root = std::env::temp_dir().join(format!("floral-activity-test-{}", Uuid::new_v4()));
        let directory = activity_dir(&root);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("2026-07-31.json"), "{}").unwrap();
        fs::write(directory.join("2026-08-01.json"), "{}").unwrap();
        fs::write(directory.join("2026-09-01.json"), "{}").unwrap();

        prune_before(&root, NaiveDate::from_ymd_opt(2026, 8, 1).unwrap()).unwrap();

        assert!(!directory.join("2026-07-31.json").exists());
        assert!(directory.join("2026-08-01.json").exists());
        assert!(directory.join("2026-09-01.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_expired_activity_files_in_the_sync_tree() {
        assert!(is_expired_activity_repo_path(
            "workspaces/我的花笺/.floral-originals/activity-log/2020-01-01.json"
        ));
        assert!(!is_expired_activity_repo_path(
            "workspaces/我的花笺/images/note/image.png"
        ));
    }

    #[test]
    fn sync_merge_combines_periods_from_different_devices() {
        let local = ActivityDay {
            date: "2026-09-01".into(),
            morning: ActivityPeriod { text: "本地上午".into(), updated_at: Some(Utc::now()) },
            ..Default::default()
        };
        let remote = ActivityDay {
            date: "2026-09-01".into(),
            evening: ActivityPeriod { text: "远端晚上".into(), updated_at: Some(Utc::now()) },
            ..Default::default()
        };
        let merged: ActivityDay = serde_json::from_slice(
            &merge_sync_days(&serde_json::to_vec(&local).unwrap(), &serde_json::to_vec(&remote).unwrap()).unwrap(),
        ).unwrap();
        assert_eq!(merged.morning.text, "本地上午");
        assert_eq!(merged.evening.text, "远端晚上");
    }
}

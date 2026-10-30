//! Terminal device identity.
//!
//! Each installation generates a random install ID on first launch and keeps it in
//! `<app data dir>/device.json`. The ID identifies this terminal to the cloud API
//! (X-Compriva-Device header) and prefixes the operation IDs it creates while offline.
//! The server-assigned terminal code and device token are added during registration
//! (Devices module) and are not part of this file.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const FILE_NAME: &str = "device.json";

/// Persisted part of the identity. Never rewritten once created.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredIdentity {
    install_id: String,
    created_at: String,
}

/// Identity returned to the UI via the `device_identity` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub install_id: String,
    pub created_at: String,
    pub machine_name: Option<String>,
    pub os: &'static str,
    pub app_version: String,
}

/// Loads the identity from `dir`, creating it on first launch.
pub fn load_or_create(dir: &Path, app_version: &str) -> io::Result<DeviceIdentity> {
    let path = dir.join(FILE_NAME);

    let stored = match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str::<StoredIdentity>(&json).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: {e}", path.display()),
            )
        })?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => create(dir, &path)?,
        Err(e) => return Err(e),
    };

    Ok(DeviceIdentity {
        install_id: stored.install_id,
        created_at: stored.created_at,
        machine_name: std::env::var("COMPUTERNAME").ok(),
        os: std::env::consts::OS,
        app_version: app_version.to_owned(),
    })
}

fn create(dir: &Path, path: &PathBuf) -> io::Result<StoredIdentity> {
    fs::create_dir_all(dir)?;

    let stored = StoredIdentity {
        install_id: Uuid::new_v4().to_string(),
        created_at: unix_timestamp_iso(),
    };

    // Write to a temp file and rename, so a crash never leaves a half-written identity.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&stored)?)?;
    fs::rename(&tmp, path)?;

    Ok(stored)
}

/// UTC timestamp as `YYYY-MM-DDTHH:MM:SSZ`, without pulling in a date crate.
fn unix_timestamp_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_identity_once_and_reuses_it() {
        let dir = tempfile::tempdir().unwrap();

        let first = load_or_create(dir.path(), "0.1.0").unwrap();
        let second = load_or_create(dir.path(), "0.2.0").unwrap();

        assert!(Uuid::parse_str(&first.install_id).is_ok());
        assert_eq!(first.install_id, second.install_id);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(second.app_version, "0.2.0");
    }

    #[test]
    fn corrupt_file_is_an_error_not_a_new_identity() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), "not json").unwrap();

        assert!(load_or_create(dir.path(), "0.1.0").is_err());
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(20_756), (2026, 10, 30));
    }
}

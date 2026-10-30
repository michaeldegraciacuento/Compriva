//! Secrets kept in the Windows Credential Manager (Keychain / Secret Service
//! elsewhere), never in files or the SQLite database.
//!
//! Only whitelisted keys can be used, so the UI cannot read or overwrite
//! arbitrary credentials of the Windows user.

use keyring::{Entry, Error};

const SERVICE: &str = "com.compriva.pos";

/// Keys the UI may use. `device_token`: the terminal's Sanctum token (pairing).
const ALLOWED_KEYS: &[&str] = &["device_token"];

fn entry(key: &str) -> Result<Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err(format!("secure store key '{key}' is not allowed"));
    }
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

pub fn get(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|e| e.to_string())
}

pub fn delete(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Touches the real OS credential store, so it only runs on request:
    /// `cargo test -- --ignored credential_store_roundtrip` (on a machine with no paired terminal).
    #[test]
    #[ignore]
    fn credential_store_roundtrip() {
        delete("device_token").unwrap();
        assert_eq!(get("device_token").unwrap(), None);

        set("device_token", "1|test-token").unwrap();
        assert_eq!(
            get("device_token").unwrap().as_deref(),
            Some("1|test-token")
        );

        delete("device_token").unwrap();
        assert_eq!(get("device_token").unwrap(), None);
    }

    #[test]
    fn rejects_keys_outside_the_whitelist() {
        assert!(get("windows_password").is_err());
        assert!(set("../../etc", "x").is_err());
        assert!(delete("anything").is_err());
    }
}

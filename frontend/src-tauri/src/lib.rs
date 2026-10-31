mod device;
mod local_db;
mod local_tx;
mod offline_auth;
mod printing;
mod secure_store;

use tauri::{Manager, State};

use device::DeviceIdentity;

/// Returns this terminal's identity (see `device.rs`).
#[tauri::command]
fn device_identity(identity: State<'_, DeviceIdentity>) -> DeviceIdentity {
    identity.inner().clone()
}

#[tauri::command]
fn secure_store_get(key: String) -> Result<Option<String>, String> {
    secure_store::get(&key)
}

#[tauri::command]
fn secure_store_set(key: String, value: String) -> Result<(), String> {
    secure_store::set(&key, &value)
}

#[tauri::command]
fn secure_store_delete(key: String) -> Result<(), String> {
    secure_store::delete(&key)
}

/// bcrypt is deliberately slow (~250 ms); run it off the main thread.
#[tauri::command]
async fn verify_pin(pin: String, hash: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || offline_auth::verify_pin(&pin, &hash))
        .await
        .map_err(|e| e.to_string())
}

/// Windows printers with their status (see `printing.rs`).
#[tauri::command]
async fn list_printers() -> Result<Vec<printing::PrinterInfo>, String> {
    tauri::async_runtime::spawn_blocking(printing::list_printers)
        .await
        .map_err(|e| e.to_string())?
}

/// Sends raw ESC/POS bytes to a printer (receipts, cash drawer pulse).
#[tauri::command]
async fn print_raw(printer: String, data: Vec<u8>, job_name: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || printing::print_raw(&printer, &data, &job_name))
        .await
        .map_err(|e| e.to_string())?
}

/// Runs several SQL statements in one transaction (see `local_tx.rs`).
#[tauri::command]
async fn local_transaction(app: tauri::AppHandle, db: String, statements: Vec<local_tx::Statement>) -> Result<u64, String> {
    local_tx::run(&app, &db, statements).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(local_db::LOCAL_DB_URL, local_db::migrations())
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app.path().app_data_dir()?;
            let version = app.package_info().version.to_string();
            let identity = device::load_or_create(&data_dir, &version).map_err(|e| {
                // Never silently replace a corrupt identity: the terminal would appear as a new device.
                format!(
                    "cannot load device identity from {}: {e}",
                    data_dir.display()
                )
            })?;
            log::info!("device install id {}", identity.install_id);
            app.manage(identity);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_identity,
            secure_store_get,
            secure_store_set,
            secure_store_delete,
            verify_pin,
            local_transaction,
            list_printers,
            print_raw
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

//! Receipt printers and cash drawers (docs/README.md).
//!
//! - `list_printers`: the Windows printers with their status, so the app can
//!   offer a choice and warn when the receipt printer is offline.
//! - `print_raw`: sends bytes straight to a printer through the Windows spooler
//!   ("RAW" datatype, no driver rendering). Thermal receipt printers take
//!   ESC/POS commands this way, and a cash drawer wired to the printer's RJ11
//!   port opens with the ESC/POS "pulse" command. The bytes are built in the
//!   app (frontend/src/modules/hardware/escpos.ts).
//!
//! Printing is never part of a sale: the app calls these only after the sale
//! is saved, and an error here only offers a reprint.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    /// Ready, Offline, Error, Paused, … as Windows reports it.
    pub status: String,
    pub driver: Option<String>,
    pub port: Option<String>,
}

/// One row of `Get-CimInstance Win32_Printer | ConvertTo-Json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CimPrinter {
    name: String,
    #[serde(default)]
    default: bool,
    #[serde(default)]
    work_offline: bool,
    #[serde(default)]
    printer_status: Option<u16>,
    #[serde(default)]
    driver_name: Option<String>,
    #[serde(default)]
    port_name: Option<String>,
}

/// Win32_Printer.PrinterStatus: 1 Other, 2 Unknown, 3 Idle, 4 Printing, 5 Warmup, 6 Stopped, 7 Offline.
fn status_label(printer: &CimPrinter) -> String {
    if printer.work_offline {
        return "Offline".into();
    }
    match printer.printer_status {
        Some(3) | Some(4) | Some(5) => "Ready",
        Some(6) => "Stopped",
        Some(7) => "Offline",
        Some(1) => "Error",
        _ => "Unknown",
    }
    .into()
}

/// Parses the JSON PowerShell prints: an object for one printer, an array for several.
pub fn parse_printers(json: &str) -> Result<Vec<PrinterInfo>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<CimPrinter> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).map_err(|e| e.to_string())?
    } else {
        vec![serde_json::from_str(trimmed).map_err(|e| e.to_string())?]
    };
    Ok(rows
        .into_iter()
        .map(|p| PrinterInfo {
            status: status_label(&p),
            is_default: p.default,
            driver: p.driver_name,
            port: p.port_name,
            name: p.name,
        })
        .collect())
}

#[cfg(windows)]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,DriverName,PortName | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("cannot list printers: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    parse_printers(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(windows))]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    Ok(Vec::new())
}

/// Sends raw bytes to a Windows printer (RAW datatype) and returns the bytes written.
#[cfg(windows)]
pub fn print_raw(printer: &str, data: &[u8], job_name: &str) -> Result<u32, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
        PRINTER_HANDLE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn last_error(what: &str) -> String {
        format!("{what} failed (Windows error {})", unsafe { GetLastError() })
    }

    let name = wide(printer);
    let job = wide(job_name);
    let datatype = wide("RAW");

    // SAFETY: plain Win32 spooler calls; every handle is closed on all paths below.
    unsafe {
        let mut handle = PRINTER_HANDLE { Value: null_mut() };
        if OpenPrinterW(name.as_ptr(), &mut handle, null()) == 0 {
            return Err(format!("Printer \"{printer}\" was not found or cannot be opened ({})", last_error("OpenPrinter")));
        }

        let info = DOC_INFO_1W { pDocName: job.as_ptr() as *mut u16, pOutputFile: null_mut(), pDatatype: datatype.as_ptr() as *mut u16 };
        let result = (|| {
            if StartDocPrinterW(handle, 1, &info) == 0 {
                return Err(last_error("StartDocPrinter"));
            }
            if StartPagePrinter(handle) == 0 {
                EndDocPrinter(handle);
                return Err(last_error("StartPagePrinter"));
            }
            let mut written: u32 = 0;
            let ok = WritePrinter(handle, data.as_ptr() as *const _, data.len() as u32, &mut written);
            EndPagePrinter(handle);
            EndDocPrinter(handle);
            if ok == 0 {
                return Err(last_error("WritePrinter"));
            }
            if written as usize != data.len() {
                return Err(format!("only {written} of {} bytes reached the printer", data.len()));
            }
            Ok(written)
        })();
        ClosePrinter(handle);
        result
    }
}

#[cfg(not(windows))]
pub fn print_raw(_printer: &str, _data: &[u8], _job_name: &str) -> Result<u32, String> {
    Err("Raw printing is only available on Windows terminals.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_one_or_many_printers_with_their_status() {
        let one = r#"{"Name":"EPSON TM-T82","Default":true,"WorkOffline":false,"PrinterStatus":3,"DriverName":"EPSON TM-T82 Receipt","PortName":"USB001"}"#;
        assert_eq!(
            parse_printers(one).unwrap(),
            vec![PrinterInfo { name: "EPSON TM-T82".into(), is_default: true, status: "Ready".into(), driver: Some("EPSON TM-T82 Receipt".into()), port: Some("USB001".into()) }]
        );

        let many = r#"[{"Name":"A","Default":false,"WorkOffline":true,"PrinterStatus":3},{"Name":"B","PrinterStatus":7},{"Name":"C"}]"#;
        let statuses: Vec<String> = parse_printers(many).unwrap().into_iter().map(|p| p.status).collect();
        assert_eq!(statuses, ["Offline", "Offline", "Unknown"]);
        assert!(parse_printers("").unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn lists_the_printers_installed_on_this_computer() {
        // Runs PowerShell for real; on a build machine there is at least "Microsoft Print to PDF".
        let printers = list_printers().expect("printers can be listed");
        assert!(printers.iter().all(|p| !p.name.is_empty()));
    }

    #[cfg(windows)]
    #[test]
    fn printing_to_a_missing_printer_is_a_clear_error() {
        let error = print_raw("No Such Printer 42", b"test", "Compriva test").unwrap_err();
        assert!(error.contains("No Such Printer 42"), "{error}");
    }
}

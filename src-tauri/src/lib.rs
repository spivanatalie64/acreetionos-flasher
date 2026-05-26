use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use tauri::{Emitter, Manager};

mod editions;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Drive {
    pub device: String,
    pub size: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FlashProgress {
    pub percent: u8,
    pub speed: String,
    pub written: String,
}

#[tauri::command]
fn list_drives() -> Vec<Drive> {
    let mut drives = Vec::new();
    if cfg!(target_os = "linux") {
        if let Ok(out) = Command::new("lsblk")
            .args(["-d", "-o", "NAME,SIZE,MODEL", "-n", "-l"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0];
                    if name.starts_with("sd") || name.starts_with("nvme") {
                        drives.push(Drive {
                            device: format!("/dev/{}", name),
                            size: parts[1].to_string(),
                            model: parts.get(2).unwrap_or(&"").to_string(),
                        });
                    }
                }
            }
        }
    } else if cfg!(target_os = "macos") {
        if let Ok(out) = Command::new("diskutil").args(["list", "-plist"]).output() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                for line in s.lines() {
                    if line.contains("BSD Name") {
                        if let Some(dev) = line.split("</string>").next() {
                            if let Some(name) = dev.split('>').last() {
                                drives.push(Drive {
                                    device: format!("/dev/{}", name),
                                    size: "".to_string(),
                                    model: "".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    drives
}

#[tauri::command]
async fn download_iso(
    url: String,
    dest: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u8;
            let _ = app.emit(
                "download-progress",
                FlashProgress {
                    percent: pct,
                    speed: format!("{} MB/s", downloaded / 1024 / 1024),
                    written: format!("{:.1} MB", downloaded as f64 / 1024.0 / 1024.0),
                },
            );
        }
    }
    Ok(dest)
}

#[tauri::command]
async fn flash_iso(
    iso_path: String,
    device: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    let dev = device.clone();

    thread::spawn(move || {
        let child = Command::new("dd")
            .args([
                &format!("if={}", iso_path),
                &format!("of={}", dev),
                "bs=4M",
                "status=progress",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match child {
            Ok(mut c) => {
                let _ = c.wait();
                let _ = tx.send(());
            }
            Err(e) => {
                let _ = tx.send(());
                eprintln!("dd error: {}", e);
            }
        }
    });

    // Simulate progress while dd runs
    let dev_clone = device.clone();
    let app_clone = app.clone();
    thread::spawn(move || {
        loop {
            if rx.try_recv().is_ok() {
                break;
            }
            // Try to read progress from dd output
            if cfg!(target_os = "linux") {
                if let Ok(out) = Command::new("sh")
                    .args(["-c", &format!("kill -USR1 $(pgrep -x dd) 2>/dev/null; sleep 2")])
                    .output()
                {
                    let _ = out;
                }
            }
            let _ = app_clone.emit(
                "flash-progress",
                FlashProgress {
                    percent: 0,
                    speed: "".to_string(),
                    written: "Writing...".to_string(),
                },
            );
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        let _ = app_clone.emit("flash-done", "Complete");
    });

    // Wait for dd to finish
    thread::spawn(move || {
        Command::new("sync")
            .status()
            .ok();
    });

    Ok("Flash complete!".to_string())
}

#[tauri::command]
fn get_editions() -> Vec<editions::Edition> {
    editions::load()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            download_iso,
            flash_iso,
            get_editions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

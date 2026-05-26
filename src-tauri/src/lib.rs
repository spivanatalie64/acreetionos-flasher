use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
        if let Ok(out) = std::process::Command::new("lsblk")
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
        if let Ok(out) = std::process::Command::new("diskutil").args(["list", "-plist"]).output() {
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
    let mut child = Command::new("dd")
        .args([
            &format!("if={}", iso_path),
            &format!("of={}", device),
            "bs=4M",
            "status=progress",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn dd: {}", e))?;

    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stderr);
    let app_clone = app.clone();

    let _progress_handle = tokio::spawn(async move {
        let mut lines = reader.lines();
        let mut last_bytes: u64 = 0;
        let mut last_time = std::time::Instant::now();

        while let Ok(Some(line)) = lines.next_line().await {
            if line.contains("bytes copied") {
                if let Some(bytes_str) = line.split_whitespace().next() {
                    if let Ok(bytes) = bytes_str.replace(',', "").parse::<u64>() {
                        let elapsed = last_time.elapsed().as_secs_f64();
                        let speed = if elapsed > 0.0 {
                            (bytes as f64 - last_bytes as f64) / elapsed / 1024.0 / 1024.0
                        } else {
                            0.0
                        };
                        last_bytes = bytes;
                        last_time = std::time::Instant::now();
                        let _ = app_clone.emit(
                            "flash-progress",
                            FlashProgress {
                                percent: 0,
                                speed: format!("{:.1} MB/s", speed),
                                written: format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0),
                            },
                        );
                    }
                }
            }
        }
        let _ = app_clone.emit("flash-done", "Complete");
    });

    let status = child.wait().await.map_err(|e| format!("dd failed: {}", e))?;

    if status.success() {
        let _ = std::process::Command::new("sync").status();
        Ok("Flash complete!".to_string())
    } else {
        Err("dd reported a failure".to_string())
    }
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

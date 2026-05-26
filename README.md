# AcreetionOS USB Flasher

A Tauri desktop application for downloading and flashing AcreetionOS ISOs to USB drives.

## Features

- **List editions** — Fetches latest ISO names/URLs at build time
- **Download** — Downloads the selected ISO from Cloudflare R2
- **Flash** — Writes the ISO to a USB drive via `dd`
- **Cross-platform** — Linux, Windows, macOS

## Build

```bash
node generate-editions.js
npm install
npm run tauri build
```

## Usage

1. Select an edition
2. Select your USB drive
3. Click "Download & Flash"
4. Wait for completion
5. Boot from the USB drive

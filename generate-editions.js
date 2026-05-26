#!/usr/bin/env node
// generate-editions.js — Fetches latest ISO URLs and updates editions.json
// Run before Tauri build so the app always has current download links.

const https = require('https');
const fs = require('fs');
const path = require('path');

const EDITIONS_FILE = path.join(__dirname, 'src-tauri', 'editions.json');
const WEB_EDITIONS_FILE = path.join(__dirname, 'src', 'editions.json');
const GITHUB_API = 'https://api.github.com';
const CF_R2 = 'https://pub-173a1f638a3b4c95b5f58b09c0b968aa.r2.dev';

const DEFAULT_ISO_URLS = {
  'cinnamon': 'https://iso.acreetionos.org:8448/acreetion/AcreetionOS-1.0-x86_64.iso',
  'xl': 'https://iso.acreetionos.org:8448/acreetion/AcreetionOS_XL-1.0-x86_64.iso',
  '32bit': `${CF_R2}/AcreetionOS32-latest.iso`,
  'hyprland': `${CF_R2}/AcreetionOS-Hyprland-latest.iso`,
  'plasma': `${CF_R2}/AcreetionOS-Plasma-latest.iso`,
  'mate': `${CF_R2}/AcreetionOS-MATE-latest.iso`,
  'gnome': `${CF_R2}/AcreetionOS-GNOME-latest.iso`,
  'xfce': `${CF_R2}/AcreetionOS-XFCE-latest.iso`,
  'sway': `${CF_R2}/AcreetionOS-Sway-latest.iso`,
  'i3': `${CF_R2}/AcreetionOS-i3-latest.iso`,
};

async function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AcreetionOS-Flasher' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function getLatestRelease(repo) {
  try {
    const data = await get(`${GITHUB_API}/repos/${repo}/releases/latest`);
    if (data.assets) {
      for (const a of data.assets) {
        if (a.name.endsWith('.iso')) return a.browser_download_url;
      }
    }
  } catch {}
  return '';
}

async function main() {
  let editions;
  try {
    editions = JSON.parse(fs.readFileSync(EDITIONS_FILE, 'utf-8'));
  } catch {
    editions = [];
  }

  // Apply default R2 URLs for any edition that's missing one
  for (const ed of editions) {
    if (!ed.iso_url && DEFAULT_ISO_URLS[ed.name]) {
      ed.iso_url = DEFAULT_ISO_URLS[ed.name];
    }
    if (!ed.zip_url && DEFAULT_ISO_URLS[ed.name]) {
      ed.zip_url = DEFAULT_ISO_URLS[ed.name].replace('.iso', '.iso.zip');
    }
  }

  // Try to fetch latest ISOs from GitHub releases for editions that have repos
  const releaseRepos = {
    'mate': 'spivanatalie64/AcreetionOS-Mate',
    'gnome': 'spivanatalie64/acreetionos-gnome',
    'hyprland': 'spivanatalie64/acreetionos-hyprland',
    '32bit': 'spivanatalie64/acreetionos32',
  };

  for (const [name, repo] of Object.entries(releaseRepos)) {
    const url = await getLatestRelease(repo);
    if (url) {
      const ed = editions.find(e => e.name === name);
      if (ed) {
        ed.iso_url = url;
        ed.zip_url = url.replace('.iso', '.iso.zip');
        console.log(`  ${name}: ${url}`);
      }
    }
  }

  fs.writeFileSync(EDITIONS_FILE, JSON.stringify(editions, null, 2));
  fs.writeFileSync(WEB_EDITIONS_FILE, JSON.stringify(editions, null, 2));
  console.log('editions.json updated');
}

main().catch(console.error);

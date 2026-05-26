#!/usr/bin/env node
// generate-editions.js — Fetches latest ISO URLs and updates editions.json
// Run before Tauri build so the app always has current download links.

const https = require('https');
const fs = require('fs');
const path = require('path');

const EDITIONS_FILE = path.join(__dirname, 'src-tauri', 'editions.json');
const WEB_EDITIONS_FILE = path.join(__dirname, 'src', 'editions.json');
const GITHUB_API = 'https://api.github.com';
const CF_R2_PUBLIC = 'https://pub-173a1f638a3b4c95b5f58b09c0b968aa.r2.dev';

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
  const editions = JSON.parse(fs.readFileSync(EDITIONS_FILE, 'utf-8'));

  // For editions that have GitHub releases, fetch latest
  const releaseRepos = {
    'mate': 'spivanatalie64/AcreetionOS-Mate',
    'gnome': 'spivanatalie64/acreetionos-gnome',
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

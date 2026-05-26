let isTauri = typeof window !== 'undefined' && window.__TAURI__ !== undefined;
let invoke, listen;

if (isTauri) {
  invoke = window.__TAURI__.core.invoke;
  listen = window.__TAURI__.event.listen;
}

let state = {
  editions: [],
  selectedEdition: null,
  drives: [],
  selectedDrive: '',
  downloadedIso: '',
};

function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

async function init() {
  try {
    const res = await fetch('src-tauri/editions.json');
    state.editions = await res.json();
  } catch {
    try {
      state.editions = await invoke('get_editions');
    } catch (e) {
      log('Failed to load editions: ' + e);
    }
  }
  renderEditions();

  if (isTauri) {
    try {
      state.drives = await invoke('list_drives');
    } catch (e) {
      log('Failed to list drives: ' + e);
    }
    renderDrives();
    document.getElementById('drive-section').style.display = 'block';
  } else {
    document.getElementById('drive-section').style.display = 'none';
  }

  const refreshBtn = document.getElementById('refresh-drives');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      try {
        state.drives = await invoke('list_drives');
        renderDrives();
      } catch (e) {
        log(`Drive refresh error: ${e}`);
      }
    };
  }

  const dlBtn = document.getElementById('btn-download');
  if (dlBtn) dlBtn.onclick = downloadOnly;

  const flashBtn = document.getElementById('btn-flash');
  if (flashBtn) flashBtn.onclick = downloadAndFlash;

  if (isTauri && listen) {
    listen('download-progress', (e) => {
      const p = e.payload;
      const fill = document.getElementById('progress-fill');
      const text = document.getElementById('progress-text');
      if (fill) fill.style.width = p.percent + '%';
      if (text) text.textContent = `${p.written} (${p.percent}%)`;
    });
    listen('flash-progress', () => {
      const text = document.getElementById('progress-text');
      if (text) text.textContent = 'Writing to USB...';
    });
    listen('flash-done', () => {
      const fill = document.getElementById('progress-fill');
      const text = document.getElementById('progress-text');
      if (fill) fill.style.width = '100%';
      if (text) text.textContent = 'Flash complete! Safe to remove the drive.';
    });
  }
}

function renderEditions() {
  const list = document.getElementById('editions-list');
  if (!list) return;
  list.innerHTML = '';
  state.editions.forEach((ed, i) => {
    const card = document.createElement('div');
    card.className = 'edition-card';
    card.innerHTML = `
      <h3>${ed.label}</h3>
      <p>${ed.description}</p>
      <div class="edition-links">
        ${ed.iso_url ? `<a href="${ed.iso_url}" class="download-link" target="_blank">Download ISO</a>` : ''}
        ${ed.source_url ? `<a href="${ed.source_url}" class="source-link" target="_blank">Source</a>` : ''}
      </div>
    `;
    card.onclick = () => selectEdition(i);
    list.appendChild(card);
  });
}

function selectEdition(i) {
  state.selectedEdition = i;
  state.downloadedIso = '';
  document.querySelectorAll('.edition-card').forEach((c, j) => {
    c.classList.toggle('selected', j === i);
  });
  const ed = state.editions[i];
  const info = document.getElementById('selected-info');
  if (info) {
    info.innerHTML = `
      <strong>${ed.label}</strong><br>
      <span style="color:#888;font-size:0.85rem">${ed.iso_url || 'No ISO available'}</span>
    `;
  }
  const actionSection = document.getElementById('action-section');
  if (actionSection) actionSection.style.display = 'block';
  if (isTauri) {
    const dlBtn = document.getElementById('btn-download');
    const flashBtn = document.getElementById('btn-flash');
    if (dlBtn) dlBtn.disabled = !ed.iso_url;
    if (flashBtn) flashBtn.disabled = !(ed.iso_url && state.selectedDrive);
  }
  const progressArea = document.getElementById('progress-area');
  if (progressArea) progressArea.style.display = 'none';
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = '0%';
}

function renderDrives() {
  const sel = document.getElementById('drive-select');
  if (!sel) return;
  sel.innerHTML = '';
  if (state.drives.length === 0) {
    sel.innerHTML = '<option>No drives found</option>';
    return;
  }
  state.drives.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.device;
    opt.textContent = `${d.device} — ${d.size} ${d.model}`;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    state.selectedDrive = sel.value;
    if (state.selectedEdition !== null) {
      const ed = state.editions[state.selectedEdition];
      const flashBtn = document.getElementById('btn-flash');
      if (flashBtn) flashBtn.disabled = !(ed && ed.iso_url && state.selectedDrive);
    }
  };
  state.selectedDrive = sel.value;
}

async function downloadOnly() {
  const ed = state.editions[state.selectedEdition];
  if (!ed || !ed.iso_url) return;
  const progressArea = document.getElementById('progress-area');
  const logSection = document.getElementById('log-section');
  if (progressArea) progressArea.style.display = 'block';
  if (logSection) logSection.style.display = 'block';
  log(`Downloading ${ed.label}...`);
  try {
    const path = await invoke('download_iso', {
      url: ed.iso_url,
      dest: `/tmp/acreetionos-${ed.name}.iso`,
    });
    state.downloadedIso = path;
    log(`Downloaded to ${path}`);
    const flashBtn = document.getElementById('btn-flash');
    if (flashBtn) flashBtn.disabled = !state.selectedDrive;
  } catch (e) {
    log(`Download failed: ${e}`);
  }
}

async function downloadAndFlash() {
  const ed = state.editions[state.selectedEdition];
  if (!ed || !ed.iso_url || !state.selectedDrive) return;

  const logSection = document.getElementById('log-section');
  const progressArea = document.getElementById('progress-area');
  if (logSection) logSection.style.display = 'block';
  if (progressArea) progressArea.style.display = 'block';

  if (!state.downloadedIso) {
    await downloadOnly();
    if (!state.downloadedIso) return;
  }

  log(`Flashing to ${state.selectedDrive}...`);
  const dlBtn = document.getElementById('btn-download');
  const flashBtn = document.getElementById('btn-flash');
  if (dlBtn) dlBtn.disabled = true;
  if (flashBtn) flashBtn.disabled = true;
  try {
    await invoke('flash_iso', {
      isoPath: state.downloadedIso,
      device: state.selectedDrive,
    });
  } catch (e) {
    log(`Flash failed: ${e}`);
  }
  if (dlBtn) dlBtn.disabled = false;
  if (flashBtn) flashBtn.disabled = false;
}

document.addEventListener('DOMContentLoaded', init);

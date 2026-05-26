const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let state = {
  editions: [],
  selectedEdition: null,
  drives: [],
  selectedDrive: '',
  downloadedIso: '',
};

function log(msg) {
  const el = document.getElementById('log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

async function init() {
  try {
    state.editions = await invoke('get_editions');
    renderEditions();

    state.drives = await invoke('list_drives');
    renderDrives();
    document.getElementById('drive-section').style.display = 'block';
  } catch (e) {
    log(`Init error: ${e}`);
  }

  document.getElementById('refresh-drives').onclick = async () => {
    try {
      state.drives = await invoke('list_drives');
      renderDrives();
    } catch (e) {
      log(`Drive refresh error: ${e}`);
    }
  };

  document.getElementById('btn-download').onclick = downloadOnly;
  document.getElementById('btn-flash').onclick = downloadAndFlash;

  if (listen) {
    listen('download-progress', (e) => {
      const p = e.payload;
      document.getElementById('progress-fill').style.width = p.percent + '%';
      document.getElementById('progress-text').textContent = `${p.written} (${p.percent}%)`;
    });
    listen('flash-progress', () => {
      document.getElementById('progress-text').textContent = 'Writing to USB...';
    });
    listen('flash-done', () => {
      document.getElementById('progress-fill').style.width = '100%';
      document.getElementById('progress-text').textContent = 'Flash complete! Safe to remove the drive.';
    });
  }
}

function renderEditions() {
  const list = document.getElementById('editions-list');
  list.innerHTML = '';
  state.editions.forEach((ed, i) => {
    const card = document.createElement('div');
    card.className = 'edition-card';
    card.innerHTML = `
      <h3>${ed.label}</h3>
      <p>${ed.description}</p>
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
  document.getElementById('selected-info').innerHTML = `
    <strong>${ed.label}</strong><br>
    <span style="color:#888;font-size:0.85rem">${ed.iso_url || 'No ISO available'}</span>
  `;
  document.getElementById('action-section').style.display = 'block';
  const hasIso = !!ed.iso_url;
  document.getElementById('btn-download').disabled = !hasIso;
  document.getElementById('btn-flash').disabled = !(hasIso && state.selectedDrive);
  document.getElementById('progress-area').style.display = 'none';
  document.getElementById('progress-fill').style.width = '0%';
}

function renderDrives() {
  const sel = document.getElementById('drive-select');
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
      document.getElementById('btn-flash').disabled = !(ed && ed.iso_url && state.selectedDrive);
    }
  };
  state.selectedDrive = sel.value;
}

async function downloadOnly() {
  const ed = state.editions[state.selectedEdition];
  if (!ed || !ed.iso_url) return;
  document.getElementById('progress-area').style.display = 'block';
  document.getElementById('log-section').style.display = 'block';
  log(`Downloading ${ed.label}...`);
  try {
    const path = await invoke('download_iso', {
      url: ed.iso_url,
      dest: `/tmp/acreetionos-${ed.name}.iso`,
    });
    state.downloadedIso = path;
    log(`Downloaded to ${path}`);
    document.getElementById('btn-flash').disabled = !state.selectedDrive;
  } catch (e) {
    log(`Download failed: ${e}`);
  }
}

async function downloadAndFlash() {
  const ed = state.editions[state.selectedEdition];
  if (!ed || !ed.iso_url || !state.selectedDrive) return;

  document.getElementById('log-section').style.display = 'block';
  document.getElementById('progress-area').style.display = 'block';

  if (!state.downloadedIso) {
    await downloadOnly();
    if (!state.downloadedIso) return;
  }

  log(`Flashing to ${state.selectedDrive}...`);
  document.getElementById('btn-download').disabled = true;
  document.getElementById('btn-flash').disabled = true;
  try {
    await invoke('flash_iso', {
      isoPath: state.downloadedIso,
      device: state.selectedDrive,
    });
  } catch (e) {
    log(`Flash failed: ${e}`);
  }
  document.getElementById('btn-download').disabled = false;
  document.getElementById('btn-flash').disabled = false;
}

document.addEventListener('DOMContentLoaded', init);

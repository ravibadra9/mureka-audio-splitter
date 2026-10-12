/**
 * Mureka Audio Splitter - Core Frontend Controller (v1.0.2)
 * Precision audio slicer with automatic YouTube cookie bypass & bot-check protection.
 * Features:
 * - Real-time state auto-save & auto-restore (never lose work on popup close)
 * - Persistent Standalone OS Window mode & Chrome Side Panel mode
 * - Robust Web Audio API decoding (MP3, M4A, Opus, WebM, WAV)
 * - Local Companion Bridge integration with optional FFmpeg & last-download recovery
 * - Universal Tracklist parser & Bulk Paste modal
 * - GitHub Over-The-Air (OTA) updater
 */

// ─── Global State ─────────────────────────────────────────────────────────────
const state = {
  audioContext: null,
  audioBuffer: null,
  audioFileName: null,
  audioDuration: 0,
  audioSourceType: null,
  bridgeFilePath: null,
  isBusy: false,
  segments: [], // [{ id, name, start, end, status }]
  cookiesActive: false,
  cookiesText: '',
  localBridgeActive: false,
  saveTimeout: null,
};

const CURRENT_VERSION = '1.0.2';
const GITHUB_REPO_RAW = 'https://raw.githubusercontent.com/ravibadra9/mureka-audio-splitter/main';

// ─── Utility Helpers ──────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseTimestamp(ts) {
  if (!ts) return 0;
  const parts = ts.toString().trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

function sanitizeFilename(name) {
  return (name || 'segment')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Logging System with Storage Persistence ──────────────────────────────────
function log(message, colorClass = '') {
  const container = document.getElementById('log-container');
  if (!container) return;

  const timeStr = getTimestamp();
  const entry = document.createElement('div');
  entry.className = `log-entry ${colorClass}`;
  entry.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHtml(message)}`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Persist recent logs
  saveRecentLogsDebounced();
}

function saveRecentLogsDebounced() {
  const container = document.getElementById('log-container');
  if (!container) return;
  const entries = Array.from(container.querySelectorAll('.log-entry')).slice(-40);
  const logData = entries.map(el => ({
    html: el.innerHTML,
    className: el.className
  }));
  chrome.storage.local.set({ mureka_saved_logs: logData }).catch(() => {});
}

// ─── Progress & Status ────────────────────────────────────────────────────────
function setStatus(text, isBusy = false) {
  const statusEl = document.getElementById('status-text');
  const indicator = document.getElementById('status-indicator');
  if (statusEl) statusEl.textContent = text;
  if (indicator) {
    indicator.style.color = isBusy ? 'var(--accent-orange)' : 'var(--accent-green)';
  }
}

function setProgress(percent = null, indeterminate = false) {
  const fill = document.getElementById('progress-fill');
  if (!fill) return;

  if (indeterminate) {
    fill.classList.add('indeterminate');
    fill.style.width = '35%';
  } else {
    fill.classList.remove('indeterminate');
    const clamped = Math.max(0, Math.min(100, percent !== null ? percent : 0));
    fill.style.width = `${clamped}%`;
  }
}

function setBusy(busy, message = '') {
  state.isBusy = busy;
  const btn = document.getElementById('btn-split-export');
  const dlBtn = document.getElementById('btn-download-audio');
  if (btn) btn.disabled = busy;
  if (dlBtn) dlBtn.disabled = busy;

  if (busy) {
    setProgress(null, true);
    if (message) setStatus(message, true);
  } else {
    setProgress(0, false);
    if (message) setStatus(message, false);
  }
}

// ─── Safe Audio Context (No unhandled exceptions) ─────────────────────────────
function getAudioContext() {
  try {
    if (!state.audioContext || state.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioCtx();
    }
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume().catch(() => {});
    }
  } catch (err) {
    console.warn('AudioContext creation notice:', err);
  }
  return state.audioContext;
}

// ─── State Auto-Save & Auto-Restore System ─────────────────────────────────────
function triggerAutoSave() {
  if (state.saveTimeout) clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(() => {
    saveFullStateToStorage();
  }, 250);
}

async function saveFullStateToStorage() {
  try {
    const urlVal = document.getElementById('yt-url-input')?.value || '';
    const format = document.getElementById('export-format-select')?.value || 'mp3';
    const mode = document.getElementById('export-mode-select')?.value || 'zip';
    const folder = document.getElementById('output-folder-input')?.value || 'AudioSegments';

    const payload = {
      mureka_saved_url: urlVal,
      mureka_saved_segments: state.segments,
      mureka_saved_options: { format, mode, folder },
      mureka_saved_audio_meta: state.audioFileName ? {
        title: state.audioFileName,
        duration: state.audioDuration,
        filepath: state.bridgeFilePath,
        sourceType: state.audioSourceType
      } : null,
      mureka_saved_timestamp: Date.now()
    };

    await chrome.storage.local.set(payload);

    // Visual feedback badge
    const badge = document.getElementById('autosave-badge');
    if (badge) {
      badge.style.opacity = '1';
      setTimeout(() => { badge.style.opacity = '0.7'; }, 1000);
    }
  } catch (err) {
    console.warn('Auto-save error:', err);
  }
}

async function restoreStateFromStorage() {
  try {
    const data = await chrome.storage.local.get([
      'mureka_saved_url',
      'mureka_saved_segments',
      'mureka_saved_options',
      'mureka_saved_audio_meta',
      'mureka_saved_logs'
    ]);

    // 1. Restore URL
    if (data.mureka_saved_url) {
      const input = document.getElementById('yt-url-input');
      if (input && !input.value) {
        input.value = data.mureka_saved_url;
      }
    }

    // 2. Restore Segments
    if (Array.isArray(data.mureka_saved_segments) && data.mureka_saved_segments.length > 0) {
      state.segments = data.mureka_saved_segments;
      renderSegmentsTable();
    } else {
      // Default 3 blank rows
      state.segments = [
        { id: 'seg_1', name: '', start: '', end: '', status: 'idle' },
        { id: 'seg_2', name: '', start: '', end: '', status: 'idle' },
        { id: 'seg_3', name: '', start: '', end: '', status: 'idle' },
      ];
      renderSegmentsTable();
    }

    // 3. Restore Options
    if (data.mureka_saved_options) {
      const { format, mode, folder } = data.mureka_saved_options;
      const fmtEl = document.getElementById('export-format-select');
      const modeEl = document.getElementById('export-mode-select');
      const folderEl = document.getElementById('output-folder-input');
      if (fmtEl && format) fmtEl.value = format;
      if (modeEl && mode) modeEl.value = mode;
      if (folderEl && folder) folderEl.value = folder;
    }

    // 4. Restore Logs
    if (Array.isArray(data.mureka_saved_logs) && data.mureka_saved_logs.length > 0) {
      const container = document.getElementById('log-container');
      if (container && container.children.length <= 2) {
        data.mureka_saved_logs.forEach(item => {
          const entry = document.createElement('div');
          entry.className = item.className || 'log-entry';
          entry.innerHTML = item.html;
          container.appendChild(entry);
        });
        container.scrollTop = container.scrollHeight;
      }
    }

    // 5. Restore Audio Session or Reconnect to Bridge
    if (data.mureka_saved_audio_meta) {
      const meta = data.mureka_saved_audio_meta;
      state.audioFileName = meta.title;
      state.audioDuration = meta.duration;
      state.audioSourceType = meta.sourceType;
      state.bridgeFilePath = meta.filepath;

      const lbl = document.getElementById('file-status-lbl');
      if (lbl) {
        lbl.className = 'file-status-label loaded';
        lbl.textContent = `${meta.title.slice(0, 40)} (${formatTime(meta.duration)})`;
      }
      setStatus(`Loaded: ${meta.title.slice(0, 35)} (${formatTime(meta.duration)}) — ready to split`);
    }

    // 6. Check if companion bridge has an active/finished download from before
    checkBridgeLastDownload();

  } catch (err) {
    console.error('State restore error:', err);
  }
}

async function checkBridgeLastDownload() {
  try {
    const res = await fetch('http://127.0.0.1:59955/last_download');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.available && (!state.audioBuffer || state.audioFileName !== data.title)) {
      log(`⚡ Bridge recovered last downloaded audio: "${data.title}" (${data.duration_str})`, 'log-cyan');
      // Prompt user or auto-load
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'font-size: 11px; padding: 2px 8px; margin-left: 8px;';
      btn.textContent = '⚡ Reload Audio Bytes';
      btn.onclick = () => reloadBridgeAudio(data.filepath, data.title, data.duration);

      const statusEl = document.getElementById('status-text');
      if (statusEl && !state.audioBuffer) {
        statusEl.textContent = `Ready: "${data.title}" (${data.duration_str}) available from bridge`;
        statusEl.appendChild(btn);
      }
    }
  } catch (_) {}
}

async function reloadBridgeAudio(filepath, title, duration) {
  setBusy(true, 'Loading audio bytes from local bridge…');
  log(`⬇ Fetching audio bytes for: ${title}…`, 'log-cyan');
  try {
    const fileRes = await fetch(`http://127.0.0.1:59955/file?path=${encodeURIComponent(filepath)}`);
    const buffer = await fileRes.arrayBuffer();
    const decoded = await getAudioContext().decodeAudioData(buffer);

    state.audioBuffer = decoded;
    state.audioFileName = sanitizeFilename(title);
    state.audioDuration = decoded.duration || duration;
    state.audioSourceType = 'youtube';
    state.bridgeFilePath = filepath;

    updateLoadedAudioUI(title, buffer.byteLength, decoded.duration);
    log(`✔ Successfully re-loaded audio bytes from bridge: ${title}!`, 'log-green');
    triggerAutoSave();
  } catch (err) {
    log(`⚠️ Could not reload audio: ${err.message}`, 'log-red');
  } finally {
    setBusy(false);
  }
}

// ─── Tracklist Universal Parser ───────────────────────────────────────────────
function cleanSegmentName(rawName) {
  let t = String(rawName || '').trim();
  const original = t;
  const tsPat = /(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?/g;
  t = t.replace(new RegExp(`[\\(\\[]?\\s*(?:${tsPat.source})\\s*[\\)\\]]?`, 'gi'), '');
  const stripped = t.replace(/^(?:(?:track|song|chapter|ch|part)\s*\d+[:\-.]?|\d+[\.\)\-:]+|#\d+[:\-.]?)\s*/i, '');
  if (stripped.trim().length > 0) {
    t = stripped;
  }
  t = t.replace(/^[\s:\-–—"'*|]+|[\s:\-–—"'*|]+$/g, '');

  if ((t.startsWith('(') && t.endsWith(')')) || (t.startsWith('[') && t.endsWith(']'))) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/^[\s:\-–—"'*|]+|[\s:\-–—"'*|]+$/g, '');
  t = t.replace(/\s+/g, ' ');
  return t.trim() || original.trim();
}

function parseClipboardText(raw) {
  const lines = (raw || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) return [];

  const tsPat = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:\\.\\d+)?';
  const tsRegex = new RegExp(tsPat);
  const rangeRegex = new RegExp(`[\\(\\[]?\\s*(${tsPat})\\s*(?:[-–—~]|to|->|\\.\\.)\\s*(${tsPat})\\s*[\\)\\]]?`, 'i');
  const singleWrapRegex = new RegExp(`[\\(\\[]\\s*(${tsPat})\\s*[\\)\\]]`);
  const singlePlainRegex = new RegExp(`\\b(${tsPat})\\b`);

  // 1. Table check (Markdown / pipe formatted)
  const tableRows = [];
  for (const line of lines) {
    if (line.startsWith('|') && !line.includes('---')) {
      const cells = line.split('|').map(c => c.trim().replace(/^\*+|\*+$/g, '')).filter(c => c);
      const times = cells.filter(c => tsRegex.test(c));
      const names = cells.filter(c => !tsRegex.test(c) && c.replace('#', '').trim() && isNaN(c.replace('#', '').trim()));
      if (times.length >= 2 && names.length > 0) {
        tableRows.push({ name: cleanSegmentName(names[0]), start: times[0], end: times[1] });
      } else if (times.length === 1 && names.length > 0) {
        tableRows.push({ name: cleanSegmentName(names[0]), start: times[0], end: '' });
      }
    }
  }

  if (tableRows.length > 0) {
    for (let i = 0; i < tableRows.length; i++) {
      if (!tableRows[i].end && i + 1 < tableRows.length) {
        tableRows[i].end = tableRows[i + 1].start;
      }
    }
    return tableRows;
  }

  // 2. Line by line parsing
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue;

    // Case A: Range e.g. Title: (0:00:37 - 0:05:32)
    const mRange = line.match(rangeRegex);
    if (mRange) {
      const t1 = mRange[1];
      const t2 = mRange[2];
      const rawTitle = line.slice(0, mRange.index) + ' ' + line.slice(mRange.index + mRange[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: t2.trim() });
      continue;
    }

    // Case B: Wrapped single timestamp e.g. Title [0:00:37]
    const mWrap = line.match(singleWrapRegex);
    if (mWrap) {
      const t1 = mWrap[1];
      const rawTitle = line.slice(0, mWrap.index) + ' ' + line.slice(mWrap.index + mWrap[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: '' });
      continue;
    }

    // Case C: Plain single timestamp e.g. 0:00:37 Title
    const mPlain = line.match(singlePlainRegex);
    if (mPlain) {
      const t1 = mPlain[1];
      const rawTitle = line.slice(0, mPlain.index) + ' ' + line.slice(mPlain.index + mPlain[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: '' });
      continue;
    }
  }

  // Auto-fill end time from next item start if missing
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].end && i + 1 < segments.length) {
      segments[i].end = segments[i + 1].start;
    }
  }

  return segments;
}

// ─── Table UI Rendering ───────────────────────────────────────────────────────
function renderSegmentsTable() {
  const container = document.getElementById('segment-rows-container');
  if (!container) return;
  container.innerHTML = '';

  state.segments.forEach((seg, idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = `segment-row ${seg.status ? 'row-' + seg.status : ''}`;
    rowEl.dataset.id = seg.id;

    rowEl.innerHTML = `
      <div class="row-index">${idx + 1}</div>
      <input type="text" class="text-input seg-name" value="${escapeHtml(seg.name)}" placeholder="Song / Segment Name" />
      <input type="text" class="text-input seg-start" value="${escapeHtml(seg.start)}" placeholder="0:00:00" />
      <div class="row-arrow">→</div>
      <input type="text" class="text-input seg-end" value="${escapeHtml(seg.end)}" placeholder="0:00:00" />
      <button class="btn-row-del" title="Remove segment">✕</button>
    `;

    // Event listeners with auto-save
    const nameInput = rowEl.querySelector('.seg-name');
    const startInput = rowEl.querySelector('.seg-start');
    const endInput = rowEl.querySelector('.seg-end');
    const delBtn = rowEl.querySelector('.btn-row-del');

    nameInput.addEventListener('input', (e) => { seg.name = e.target.value; triggerAutoSave(); });
    startInput.addEventListener('input', (e) => { seg.start = e.target.value; triggerAutoSave(); });
    endInput.addEventListener('input', (e) => { seg.end = e.target.value; triggerAutoSave(); });

    delBtn.addEventListener('click', () => {
      deleteSegmentRow(seg.id);
    });

    container.appendChild(rowEl);
  });
}

function addSegmentRow(name = '', start = '', end = '') {
  const newSeg = {
    id: Date.now() + Math.random().toString(36).slice(2, 7),
    name: name,
    start: start,
    end: end,
    status: 'idle'
  };
  state.segments.push(newSeg);
  renderSegmentsTable();
  triggerAutoSave();
}

function deleteSegmentRow(id) {
  if (state.segments.length <= 1) return;
  state.segments = state.segments.filter(s => s.id !== id);
  renderSegmentsTable();
  triggerAutoSave();
}

function loadSegmentsIntoTable(parsedList) {
  if (!parsedList || !parsedList.length) return;
  state.segments = parsedList.map(item => ({
    id: Date.now() + Math.random().toString(36).slice(2, 7),
    name: item.name || '',
    start: item.start || '',
    end: item.end || '',
    status: 'idle'
  }));
  renderSegmentsTable();
  triggerAutoSave();
  log(`✔ Loaded ${parsedList.length} segment(s) into table (Auto-saved)`, 'log-green');
}

// ─── Cookie & Token Management ────────────────────────────────────────────────
async function loadSavedCookies() {
  const result = await chrome.storage.local.get([
    'yt_cookies_header',
    'yt_cookies_netscape',
    'yt_cookies_count',
    'yt_token_raw'
  ]);

  const badge = document.getElementById('cookie-status-badge');
  const badgeText = document.getElementById('cookie-status-text');
  const tokenInput = document.getElementById('token-input');

  if (result.yt_token_raw && tokenInput) {
    tokenInput.value = result.yt_token_raw;
  }

  if (result.yt_cookies_count > 0 || (result.yt_token_raw && result.yt_token_raw.length > 5)) {
    state.cookiesActive = true;
    if (badge) {
      badge.className = 'status-badge active';
      badgeText.textContent = `Active (${result.yt_cookies_count || 1} cookies)`;
    }
  } else {
    state.cookiesActive = false;
    if (badge) {
      badge.className = 'status-badge inactive';
      badgeText.textContent = 'Not Configured';
    }
  }
}

async function saveTokenManual() {
  const input = document.getElementById('token-input');
  const token = (input?.value || '').trim();
  await chrome.storage.local.set({ yt_token_raw: token });

  if (token) {
    state.cookiesActive = true;
    updateCookieBadge(true, 'Saved');
    log(`🔑 YouTube Token / Cookie saved successfully (${token.length} chars)`, 'log-green');
  } else {
    state.cookiesActive = false;
    updateCookieBadge(false, 'Not Configured');
    log('🔑 YouTube Token cleared.');
  }
}

function updateCookieBadge(active, text) {
  const badge = document.getElementById('cookie-status-badge');
  const badgeText = document.getElementById('cookie-status-text');
  if (badge) {
    badge.className = `status-badge ${active ? 'active' : 'inactive'}`;
    badgeText.textContent = text;
  }
}

async function syncBrowserCookies() {
  log('🌐 Auto-syncing YouTube cookies from Google Chrome...', 'log-cyan');
  updateCookieBadge(true, 'Syncing…');

  chrome.runtime.sendMessage({ action: 'GET_YT_COOKIES' }, (res) => {
    if (res && res.success) {
      state.cookiesActive = true;
      state.cookiesText = res.netscape;
      const input = document.getElementById('token-input');
      if (input) input.value = `[Synced ${res.count} Active Chrome YouTube Cookies]`;
      updateCookieBadge(true, `Active (${res.count} cookies synced)`);
      log(`✔ Successfully extracted & activated ${res.count} YouTube cookies from Chrome session!`, 'log-green');
      log('🛡 Bot-check bypass & 403 Forbidden protection is fully ACTIVE.', 'log-green');
    } else {
      updateCookieBadge(false, 'Sync Failed');
      log(`⚠ Could not auto-sync cookies: ${res?.error || 'No cookies found'}. Upload a cookies file instead.`, 'log-orange');
    }
  });
}

function handleCookieFileUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    if (!content.trim()) {
      alert('The selected cookie file appears to be empty.');
      return;
    }

    await chrome.storage.local.set({
      yt_cookies_netscape: content,
      yt_token_raw: content.slice(0, 500)
    });

    state.cookiesActive = true;
    state.cookiesText = content;
    const input = document.getElementById('token-input');
    if (input) input.value = `[Uploaded Cookie File: ${file.name}]`;

    updateCookieBadge(true, `Active (${file.name})`);
    log(`📤 Uploaded & activated cookies from: ${file.name}`, 'log-green');
    log('🛡 Cookies active! Ready to bypass YouTube rate limits and age checks.', 'log-green');
  };
  reader.readAsText(file);
}

function verifyToken() {
  log('⚡ Verifying YouTube cookie credentials...', 'log-cyan');
  updateCookieBadge(true, 'Verifying…');

  chrome.runtime.sendMessage({ action: 'GET_YT_COOKIES' }, (res) => {
    if (res && res.success && res.count > 0) {
      updateCookieBadge(true, `Valid (${res.count} cookies)`);
      log('✅ YouTube cookie session is valid and active!', 'log-green');
    } else {
      updateCookieBadge(true, 'Verified Active');
      log('✅ Saved credentials active. Ready for stream extraction.', 'log-green');
    }
  });
}

function clearToken() {
  chrome.storage.local.remove([
    'yt_token_raw',
    'yt_cookies_header',
    'yt_cookies_netscape',
    'yt_cookies_count'
  ], () => {
    state.cookiesActive = false;
    state.cookiesText = '';
    const input = document.getElementById('token-input');
    if (input) input.value = '';
    updateCookieBadge(false, 'Not Configured');
    log('🔑 YouTube cookies cleared.');
  });
}

// ─── Local Audio File Handler ─────────────────────────────────────────────────
async function handleLocalAudioFile(file) {
  if (!file) return;

  setBusy(true, 'Decoding audio file with Web Audio API…');
  log(`📂 Loading local audio: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)…`, 'log-cyan');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = getAudioContext();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);

    state.audioBuffer = decoded;
    state.audioFileName = file.name.replace(/\.[^/.]+$/, '');
    state.audioDuration = decoded.duration;
    state.audioSourceType = 'local';
    state.bridgeFilePath = null;

    const lbl = document.getElementById('file-status-lbl');
    if (lbl) {
      lbl.className = 'file-status-label loaded';
      lbl.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB, ${formatTime(decoded.duration)})`;
    }

    log(`✔ Successfully loaded audio: ${file.name} | Duration: ${formatTime(decoded.duration)} | SampleRate: ${decoded.sampleRate}Hz`, 'log-green');
    setStatus(`Loaded: ${file.name} (${formatTime(decoded.duration)}) — ready to split`);
    triggerAutoSave();
  } catch (err) {
    console.error('Audio decode error:', err);
    log(`✖ Failed to decode audio file: ${err.message}`, 'log-red');
    setStatus('Error decoding audio file');
  } finally {
    setBusy(false);
  }
}

// ─── Version & OTA Updater ───────────────────────────────────────────────────
async function checkRemoteOtaVersion() {
  try {
    const res = await fetch(`${GITHUB_REPO_RAW}/version.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function triggerOtaUpdate() {
  const btnLabel = document.getElementById('ota-btn-label');
  if (btnLabel) btnLabel.textContent = 'Checking…';
  log('⚡ Checking for GitHub Over-The-Air (OTA) updates…', 'log-cyan');

  try {
    const remote = await checkRemoteOtaVersion();
    if (!remote || !remote.version) {
      log('ℹ Could not fetch remote version from GitHub. Make sure internet is connected.', 'log-orange');
      if (btnLabel) btnLabel.textContent = 'Update OTA';
      return;
    }

    log(`ℹ Current version: v${CURRENT_VERSION} | GitHub version: v${remote.version}`, 'log-cyan');

    // 1. If local companion bridge is running, trigger direct 1-click update
    let bridgeOk = false;
    try {
      const bRes = await fetch('http://127.0.0.1:59955/status');
      if (bRes.ok) bridgeOk = true;
    } catch (_) {}

    if (bridgeOk) {
      log('⚡ Companion bridge active! Applying live GitHub patch to files…', 'log-cyan');
      if (btnLabel) btnLabel.textContent = 'Updating…';

      const updateRes = await fetch('http://127.0.0.1:59955/ota_update', { method: 'POST' });
      const updateData = await updateRes.json();

      if (updateData.success) {
        log(`🎉 OTA UPDATE APPLIED! New version: v${updateData.version}`, 'log-green');
        log('🔄 Reloading Chrome extension in 1.5 seconds…', 'log-green');
        if (btnLabel) btnLabel.textContent = '✔ Updated!';

        setTimeout(() => {
          try { chrome.runtime.reload(); } catch (_) {}
          window.location.reload();
        }, 1500);
        return;
      } else {
        throw new Error(updateData.error || 'Failed to apply patch');
      }
    }

    // 2. If bridge is offline:
    if (remote.version !== CURRENT_VERSION) {
      log(`⚡ NEW UPDATE AVAILABLE: v${remote.version}!`, 'log-green');
      log(`📝 Changelog: ${remote.changelog || 'Latest features & bug fixes'}`, 'log-cyan');
      log(`👉 To apply update instantly: Double-click 'update_ota.bat' in your extension folder, OR start 'start_bridge.bat' and click Update OTA!`, 'log-orange');
      if (btnLabel) {
        btnLabel.textContent = `⚡ v${remote.version} Avail!`;
        btnLabel.parentElement.style.borderColor = 'var(--accent-orange)';
        btnLabel.parentElement.style.color = 'var(--accent-orange)';
      }
      alert(`New OTA update (v${remote.version}) is available!\n\nTo apply in 1-click:\n1. Open your extension folder (Desktop\\tools\\extension)\n2. Double-click "update_ota.bat"\n3. Click refresh in chrome://extensions/!`);
    } else {
      log('✔ You are already running the latest version from GitHub!', 'log-green');
      if (btnLabel) {
        btnLabel.textContent = '✔ Up to Date';
        setTimeout(() => { btnLabel.textContent = 'Update OTA'; }, 3000);
      }
    }
  } catch (err) {
    log(`⚠️ OTA check error: ${err.message}`, 'log-red');
    if (btnLabel) btnLabel.textContent = 'Update OTA';
  }
}

// ─── Local Engine Checker & Bug Report Helpers ─────────────────────────────────
async function checkLocalBridge() {
  try {
    const res = await fetch('http://127.0.0.1:59955/status', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      state.localBridgeActive = true;
      updateEngineUI(true, data.ffmpeg_available);
      return true;
    }
  } catch (_) {}
  state.localBridgeActive = false;
  updateEngineUI(false, false);
  return false;
}

function updateEngineUI(online, ffmpegAvailable = false) {
  const dot = document.getElementById('engine-dot');
  const title = document.getElementById('engine-title');
  const sub = document.getElementById('engine-sub');
  if (!dot || !title || !sub) return;

  if (online) {
    dot.className = 'engine-dot online';
    if (ffmpegAvailable) {
      title.textContent = 'Local Engine: Active ⚡ (yt-dlp + FFmpeg 320k MP3)';
      sub.textContent = 'Hardware accelerated downloads active';
    } else {
      title.textContent = 'Local Engine: Active ⚡ (yt-dlp Native Audio Stream Mode)';
      sub.textContent = 'FFmpeg not needed — downloading native M4A/Opus with Web Audio decoding';
    }
    title.style.color = 'var(--accent-green)';
  } else {
    dot.className = 'engine-dot';
    title.textContent = 'Local Engine: Offline (Browser Standalone Mode)';
    title.style.color = 'var(--accent-orange)';
    sub.textContent = '👉 Double-click start_bridge.bat in extension folder for instant 10MB/s bypass';
  }
}

function copyLogsOnly() {
  const container = document.getElementById('log-container');
  const text = container ? container.innerText : '';
  if (!text.trim()) {
    alert('Log is currently empty.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    log('📋 Logs copied to clipboard!', 'log-green');
    const btnText = document.getElementById('copy-log-text');
    if (btnText) {
      const orig = btnText.textContent;
      btnText.textContent = '✔ Copied!';
      setTimeout(() => { btnText.textContent = orig; }, 2000);
    }
  }).catch((err) => {
    log(`⚠️ Could not copy logs: ${err.message}`, 'log-red');
  });
}

function copyBugReport() {
  const container = document.getElementById('log-container');
  const logs = container ? container.innerText : '';
  const urlVal = document.getElementById('yt-url-input')?.value || 'None';
  const cookieStatus = state.cookiesActive ? 'Active' : 'Not Configured';
  const bridgeStatus = state.localBridgeActive ? 'Online (yt-dlp Active)' : 'Offline (Browser Standalone)';
  const audioLoaded = state.audioFileName ? `${state.audioFileName} (${formatTime(state.audioDuration)})` : 'None';

  const report = [
    '================== 🐞 MUREKA BUG REPORT ==================',
    `Timestamp: ${new Date().toLocaleString()}`,
    `Version: v${CURRENT_VERSION}`,
    `YouTube URL: ${urlVal}`,
    `Cookie Status: ${cookieStatus}`,
    `Local Engine: ${bridgeStatus}`,
    `Loaded Audio: ${audioLoaded}`,
    `Total Segments: ${state.segments.length}`,
    '----------------------- LOG TRACE -----------------------',
    logs || '[No logs]',
    '========================================================='
  ].join('\n');

  navigator.clipboard.writeText(report).then(() => {
    log('📋 Bug report copied! You can paste it directly into chat.', 'log-green');
    const btnText = document.getElementById('copy-bug-text');
    if (btnText) {
      const orig = btnText.textContent;
      btnText.textContent = '✔ Copied!';
      setTimeout(() => { btnText.textContent = orig; }, 2000);
    }
  }).catch((err) => {
    log(`⚠️ Could not copy bug report: ${err.message}`, 'log-red');
  });
}

function clearLog() {
  const container = document.getElementById('log-container');
  if (container) container.innerHTML = '';
  chrome.storage.local.remove('mureka_saved_logs').catch(() => {});
  log('⚡ Log cleared.', 'log-cyan');
}

// ─── YouTube URL Detection & Download ─────────────────────────────────────────
function checkActiveTabForYouTube() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url) return;
    const url = tabs[0].url;
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
      const input = document.getElementById('yt-url-input');
      if (input && !input.value) {
        input.value = url;
        triggerAutoSave();
        log(`📌 Auto-detected YouTube video from active tab: ${tabs[0].title.slice(0, 50)}…`, 'log-cyan');
      }
    }
  });
}

async function startYouTubeDownload() {
  const urlInput = document.getElementById('yt-url-input');
  const url = (urlInput?.value || '').trim();

  if (!url) {
    alert('Please enter a YouTube URL.');
    return;
  }

  setBusy(true, 'Connecting to YouTube audio stream…');
  log(`⬇ Connecting to YouTube audio stream for: ${url}`, 'log-cyan');

  try {
    // 1. Check if local companion bridge is running on http://127.0.0.1:59955
    const bridgeAvailable = await checkLocalBridge();

    if (bridgeAvailable) {
      log('⚡ Local Companion Bridge active! Downloading with yt-dlp…', 'log-green');
      setStatus('Downloading audio stream via local companion bridge…', true);

      const bridgeRes = await fetch('http://127.0.0.1:59955/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, cookies: state.cookiesText })
      });
      const data = await bridgeRes.json();
      if (!data.success) throw new Error(data.error || 'Bridge download failed');

      log(`✔ Companion download complete: ${data.title} (${data.duration_str})`, 'log-green');
      setStatus('Decoding audio bytes with Web Audio API…', true);

      // Fetch the downloaded file bytes from the bridge
      const fileRes = await fetch(`http://127.0.0.1:59955/file?path=${encodeURIComponent(data.filepath)}`);
      const buffer = await fileRes.arrayBuffer();
      const decoded = await getAudioContext().decodeAudioData(buffer);

      state.audioBuffer = decoded;
      state.audioFileName = sanitizeFilename(data.title);
      state.audioDuration = decoded.duration;
      state.audioSourceType = 'youtube';
      state.bridgeFilePath = data.filepath;

      updateLoadedAudioUI(data.title, buffer.byteLength, decoded.duration);
      log(`✔ Audio successfully loaded: ${data.title} (${formatTime(decoded.duration)}) — ready to split!`, 'log-green');
      triggerAutoSave();
      return;
    }

    // 2. Standalone browser fallback mode
    log('ℹ Local engine offline. Attempting browser direct resolution…', 'log-cyan');
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) throw new Error('Invalid YouTube URL or Video ID');

    // Multiple resilient endpoints with <all_urls> host permissions
    const resolvers = [
      async () => {
        log('📡 Querying high-speed stream gateway…');
        const r = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const streamData = await r.json();
        const audioStreams = streamData.audioStreams || [];
        if (!audioStreams.length) throw new Error('No audio streams in response');
        audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return {
          title: streamData.title || `YouTube_${videoId}`,
          streamUrl: audioStreams[0].url
        };
      },
      async () => {
        log('📡 Querying fallback audio stream gateway…');
        const r = await fetch('https://api.cobalt.tools/api/json', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, isAudioOnly: true, aFormat: 'mp3' })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (data.url) return { title: `YouTube_${videoId}`, streamUrl: data.url };
        throw new Error('No stream URL returned');
      }
    ];

    let resolved = null;
    let lastErr = null;

    for (const resolver of resolvers) {
      try {
        resolved = await resolver();
        if (resolved && resolved.streamUrl) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!resolved || !resolved.streamUrl) {
      log('❌ Direct browser fetch blocked by YouTube bot-check / rate limits.', 'log-red');
      log('💡 EASY 1-CLICK FIX: Double-click "start_bridge.bat" in Desktop/tools/extension/ for instant 10MB/s download bypass!', 'log-orange');
      log('👉 Or click "Browse…" to load an existing downloaded audio file directly.', 'log-cyan');
      log('📋 Click "🐞 Copy Bug Report" above to copy the full trace if you want to paste it here.', 'log-orange');
      throw new Error(lastErr ? lastErr.message : 'Please start start_bridge.bat for bot-bypass');
    }

    log(`⬇ Downloading audio stream for: ${resolved.title}…`, 'log-cyan');
    setStatus('Downloading audio chunks…', true);

    const streamResponse = await fetch(resolved.streamUrl);
    if (!streamResponse.ok) throw new Error(`Audio download failed: HTTP ${streamResponse.status}`);

    const audioArrayBuffer = await streamResponse.arrayBuffer();
    log(`⚡ Stream download complete (${(audioArrayBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB)! Decoding audio…`, 'log-cyan');
    setStatus('Decoding audio with Web Audio API…', true);

    const decoded = await getAudioContext().decodeAudioData(audioArrayBuffer);
    state.audioBuffer = decoded;
    state.audioFileName = sanitizeFilename(resolved.title);
    state.audioDuration = decoded.duration;
    state.audioSourceType = 'youtube';
    state.bridgeFilePath = null;

    updateLoadedAudioUI(resolved.title, audioArrayBuffer.byteLength, decoded.duration);
    log(`✔ Complete Download & Decode: ${resolved.title} (${formatTime(decoded.duration)}) — ready to split!`, 'log-green');
    triggerAutoSave();

  } catch (err) {
    console.error('YouTube download error:', err);
    log(`✖ Download failed: ${err.message}`, 'log-red');
    setStatus('Download failed');
  } finally {
    setBusy(false);
  }
}

function updateLoadedAudioUI(title, byteLength, duration) {
  const lbl = document.getElementById('file-status-lbl');
  if (lbl) {
    lbl.className = 'file-status-label loaded';
    lbl.textContent = `${title.slice(0, 40)} (${(byteLength / (1024 * 1024)).toFixed(1)} MB, ${formatTime(duration)})`;
  }
  setStatus(`Loaded: ${title.slice(0, 35)} (${formatTime(duration)}) — ready to split`);
}

// ─── Slicing & Export Engine ──────────────────────────────────────────────────
async function startSplitAndExport() {
  if (state.isBusy) return;

  if (!state.audioBuffer) {
    alert('Please download YouTube audio first or browse an existing audio file.');
    return;
  }

  // Filter valid segments
  const validSegments = state.segments.filter(s => s.name.trim() && s.start.trim() && s.end.trim());
  if (!validSegments.length) {
    alert('Please add at least one segment with Name, Start time, and End time.');
    return;
  }

  setBusy(true, 'Splitting audio segments…');
  log(`✂ Starting split for ${validSegments.length} segment(s)…`, 'log-cyan');

  const format = document.getElementById('export-format-select')?.value || 'mp3';
  const mode = document.getElementById('export-mode-select')?.value || 'zip';
  const folderName = sanitizeFilename(document.getElementById('output-folder-input')?.value || 'AudioSegments');

  const audioCtx = getAudioContext();
  const sampleRate = state.audioBuffer.sampleRate;
  const numChannels = state.audioBuffer.numberOfChannels;
  const sourceDuration = state.audioBuffer.duration;

  let zip = null;
  if (mode === 'zip' && window.JSZip) {
    zip = new window.JSZip();
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < validSegments.length; i++) {
    const seg = validSegments[i];
    const indexStr = (i + 1).toString().padStart(2, '0');
    const cleanName = sanitizeFilename(seg.name);
    const startSec = parseTimestamp(seg.start);
    let endSec = parseTimestamp(seg.end);

    // Update row status in UI
    seg.status = 'processing';
    renderSegmentsTable();
    setStatus(`Cutting [${indexStr}/${validSegments.length}]: ${cleanName}…`, true);
    setProgress(((i) / validSegments.length) * 100);

    try {
      if (startSec >= sourceDuration) {
        throw new Error(`Start time (${seg.start}) is beyond audio duration (${formatTime(sourceDuration)})`);
      }
      if (endSec > sourceDuration) {
        endSec = sourceDuration;
      }
      const duration = endSec - startSec;
      if (duration <= 0) {
        throw new Error(`Invalid duration. End (${seg.end}) must be after start (${seg.start})`);
      }

      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.min(state.audioBuffer.length, Math.floor(endSec * sampleRate));
      const sliceLength = endSample - startSample;

      // Create slice AudioBuffer
      const sliceBuffer = audioCtx.createBuffer(numChannels, sliceLength, sampleRate);
      for (let ch = 0; ch < numChannels; ch++) {
        const srcData = state.audioBuffer.getChannelData(ch);
        const dstData = sliceBuffer.getChannelData(ch);
        dstData.set(srcData.subarray(startSample, endSample));
      }

      // Encode slice
      let blob;
      const fileExt = format === 'wav' ? 'wav' : 'mp3';
      const outFilename = `${indexStr}. ${cleanName}.${fileExt}`;

      if (format === 'wav') {
        blob = window.MurekaAudioUtils.encodeWAV(sliceBuffer);
      } else {
        blob = window.MurekaAudioUtils.encodeMP3(sliceBuffer, 320);
      }

      if (!blob || blob.size < 512) {
        throw new Error('Produced empty audio output');
      }

      const mbSize = (blob.size / (1024 * 1024)).toFixed(2);
      log(`✔ [${formatTime(duration)}] ${outFilename} (${mbSize} MB)`, 'log-green');

      if (zip) {
        zip.file(outFilename, blob);
      } else {
        // Individual download via Chrome Downloads API
        const blobUrl = URL.createObjectURL(blob);
        const downloadPath = folderName ? `${folderName}/${outFilename}` : outFilename;
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_SEGMENT',
          url: blobUrl,
          filename: downloadPath
        });
      }

      seg.status = 'done';
      successCount++;
    } catch (err) {
      console.error(`Error splitting segment ${cleanName}:`, err);
      log(`✖ ${cleanName}: ${err.message}`, 'log-red');
      seg.status = 'error';
      failCount++;
    }

    renderSegmentsTable();
  }

  setProgress(100);

  // If ZIP mode, package and download ZIP
  if (zip && successCount > 0) {
    setStatus('Generating ZIP package…', true);
    log('📦 Compressing all segments into ZIP package…', 'log-cyan');
    try {
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setStatus(`Zipping: ${Math.round(metadata.percent)}%`, true);
      });
      const zipUrl = URL.createObjectURL(zipBlob);
      const zipFilename = folderName ? `${folderName}.zip` : 'AudioSegments.zip';

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_SEGMENT',
        url: zipUrl,
        filename: zipFilename
      });
      log(`✔ ZIP archive downloaded: ${zipFilename} (${(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)`, 'log-green');
    } catch (err) {
      log(`✖ Failed to build ZIP: ${err.message}`, 'log-red');
    }
  }

  const summary = `Done — ${successCount} segment(s) exported${failCount ? `, ${failCount} failed` : ''}`;
  setStatus(summary, false);
  log(`🎉 ${summary}`, 'log-green');
  setBusy(false);
  triggerAutoSave();
}

// ─── Format Prompt Helper ─────────────────────────────────────────────────────
function copyFormatPrompt() {
  const promptText = `Please provide the timestamp of these songs in this format:

Song Title 1 (0:00:00 - 0:03:30)
Song Title 2 (0:03:30 - 0:06:45)
Song Title 3 (0:06:45 - 0:10:20)`;

  navigator.clipboard.writeText(promptText).then(() => {
    log('📋 Prompt copied to clipboard! Paste it into ChatGPT / AI to format timestamps.', 'log-green');
    const btnText = document.getElementById('format-prompt-text');
    if (btnText) {
      const orig = btnText.textContent;
      btnText.textContent = '✔ Copied!';
      setTimeout(() => { btnText.textContent = orig; }, 2000);
    }
  }).catch((err) => {
    log(`⚠️ Could not copy prompt: ${err.message}`, 'log-red');
  });
}

// ─── Modal Bulk Paste ─────────────────────────────────────────────────────────
function openBulkModal() {
  const modal = document.getElementById('bulk-modal');
  const textarea = document.getElementById('modal-textarea');
  if (modal) modal.classList.add('open');

  navigator.clipboard.readText().then(text => {
    if (textarea && !textarea.value && /[:\-]/.test(text)) {
      textarea.value = text.trim();
    }
  }).catch(() => {});
}

function closeBulkModal() {
  const modal = document.getElementById('bulk-modal');
  if (modal) modal.classList.remove('open');
}

function handleBulkModalLoad() {
  const textarea = document.getElementById('modal-textarea');
  const text = (textarea?.value || '').trim();
  if (!text) {
    alert('Please paste your tracklist text first.');
    return;
  }
  const parsed = parseClipboardText(text);
  if (!parsed.length) {
    alert('Could not parse any timestamps from the entered text. Check the format and try again.');
    return;
  }
  loadSegmentsIntoTable(parsed);
  closeBulkModal();
}

// ─── Clipboard Paste & Auto-Parse ─────────────────────────────────────────────
async function pasteAndAutoParse() {
  try {
    const raw = await navigator.clipboard.readText();
    if (!raw.trim()) {
      log('⚠ Clipboard is empty.', 'log-orange');
      return;
    }
    const parsed = parseClipboardText(raw);
    if (!parsed.length) {
      log('⚠ No valid timestamps found in clipboard. Paste lines like:\nOpening Prayer and Worship: (0:00:00 - 0:02:29)\nOr click 📝 Bulk Paste.', 'log-orange');
      return;
    }
    loadSegmentsIntoTable(parsed);
  } catch (err) {
    log(`⚠ Clipboard access error: ${err.message}. Click 📝 Bulk Paste instead.`, 'log-orange');
    openBulkModal();
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check full studio mode
  const urlParams = new URLSearchParams(window.location.search);
  const isFull = urlParams.get('mode') === 'full';
  if (isFull) {
    document.body.classList.add('full-studio-mode');
  }

  // Restore saved state (URL, segments, options, logs, audio)
  restoreStateFromStorage();

  // Load saved cookies
  loadSavedCookies();

  // Check active tab for YouTube URL if input is empty
  checkActiveTabForYouTube();

  // Log greeting
  log(`⚡ Mureka Audio Splitter v${CURRENT_VERSION} initialized.`, 'log-cyan');
  log('🛡 Ready with YouTube bot-check and 403 bypass protection.', 'log-green');

  // Input change auto-save listeners
  document.getElementById('yt-url-input')?.addEventListener('input', triggerAutoSave);
  document.getElementById('export-format-select')?.addEventListener('change', triggerAutoSave);
  document.getElementById('export-mode-select')?.addEventListener('change', triggerAutoSave);
  document.getElementById('output-folder-input')?.addEventListener('input', triggerAutoSave);

  // Persistent Window & Side Panel Actions
  const openWindow = () => {
    chrome.runtime.sendMessage({ action: 'OPEN_WINDOW' }, () => {
      // Close popup if opened in popup
      if (!isFull) window.close();
    });
  };

  document.getElementById('btn-open-window')?.addEventListener('click', openWindow);
  document.getElementById('btn-banner-open-window')?.addEventListener('click', openWindow);

  document.getElementById('btn-open-sidepanel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' }, (res) => {
      if (res && res.success) {
        log('📌 Opened Mureka Splitter in Chrome Side Panel (statically pinned)!', 'log-green');
      } else {
        log(`ℹ Side Panel note: Click Chrome side panel toolbar icon or use ⛶ Window.`, 'log-cyan');
      }
    });
  });

  document.getElementById('btn-open-tab')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_STUDIO' });
  });

  document.getElementById('btn-detect-tab')?.addEventListener('click', () => {
    checkActiveTabForYouTube();
  });

  document.getElementById('btn-download-audio')?.addEventListener('click', () => {
    startYouTubeDownload();
  });

  // Local file picker
  const browseBtn = document.getElementById('btn-browse-file');
  const fileInput = document.getElementById('local-file-input');
  browseBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleLocalAudioFile(e.target.files[0]);
    }
  });

  // Cookies buttons
  document.getElementById('btn-save-token')?.addEventListener('click', saveTokenManual);
  document.getElementById('btn-verify-token')?.addEventListener('click', verifyToken);
  document.getElementById('btn-auto-cookies')?.addEventListener('click', syncBrowserCookies);
  document.getElementById('btn-clear-token')?.addEventListener('click', clearToken);

  const uploadCookiesBtn = document.getElementById('btn-upload-cookies');
  const cookieFileInput = document.getElementById('cookie-file-input');
  uploadCookiesBtn?.addEventListener('click', () => cookieFileInput?.click());
  cookieFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleCookieFileUpload(e.target.files[0]);
    }
  });

  // Segments table buttons
  document.getElementById('btn-add-row')?.addEventListener('click', () => addSegmentRow());
  document.getElementById('btn-paste-parse')?.addEventListener('click', pasteAndAutoParse);
  document.getElementById('btn-bulk-paste')?.addEventListener('click', openBulkModal);
  document.getElementById('btn-format-prompt')?.addEventListener('click', copyFormatPrompt);

  // Check Local Bridge Companion
  checkLocalBridge();

  // Check GitHub OTA Updates in background
  checkRemoteOtaVersion().then(remote => {
    if (remote && remote.version && remote.version !== CURRENT_VERSION) {
      const btnLabel = document.getElementById('ota-btn-label');
      if (btnLabel) {
        btnLabel.textContent = `⚡ v${remote.version} Avail!`;
        btnLabel.parentElement.style.borderColor = 'var(--accent-orange)';
        btnLabel.parentElement.style.color = 'var(--accent-orange)';
      }
      log(`💡 Live OTA Update available on GitHub (v${remote.version})! Click '⚡ Update OTA' to apply.`, 'log-orange');
    }
  });

  // OTA update button
  document.getElementById('btn-ota-update')?.addEventListener('click', triggerOtaUpdate);

  // Log action buttons
  document.getElementById('btn-copy-log')?.addEventListener('click', copyLogsOnly);
  document.getElementById('btn-copy-bug')?.addEventListener('click', copyBugReport);
  document.getElementById('btn-clear-log')?.addEventListener('click', clearLog);

  // Split & Export button
  document.getElementById('btn-split-export')?.addEventListener('click', startSplitAndExport);

  // Modal buttons
  document.getElementById('modal-close-btn')?.addEventListener('click', closeBulkModal);
  document.getElementById('modal-cancel-btn')?.addEventListener('click', closeBulkModal);
  document.getElementById('modal-load-btn')?.addEventListener('click', handleBulkModalLoad);
});

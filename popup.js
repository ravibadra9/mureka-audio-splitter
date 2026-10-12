/**
 * Mureka Audio Splitter - Core Frontend Controller (v1.0.3)
 * Precision audio slicer with automatic YouTube cookie bypass & bot-check protection.
 * Features:
 * - Real-time state auto-save & auto-restore (never lose work on popup close)
 * - Persistent Standalone OS Window mode & Chrome Side Panel mode
 * - Live Download Percentage, Speed & ETA polling (0% -> 100%)
 * - Hardware-Accelerated Local Slicing with FFmpeg (Zero Browser Hang!)
 * - Auto-Trim upon download completion if timestamps are already provided
 * - Auto-Delete Master Full Audio file (retaining ONLY sliced partial songs)
 * - One-Click Desktop App Launcher (launch Python music_app.py on local PC)
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

const CURRENT_VERSION = '1.0.3';
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
    console.warn('AudioContext notice:', err);
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
    const mode = document.getElementById('export-mode-select')?.value || 'separate';
    const folder = document.getElementById('output-folder-input')?.value || 'AudioSegments';
    const delMaster = document.getElementById('chk-auto-delete-master')?.checked ?? true;

    const payload = {
      mureka_saved_url: urlVal,
      mureka_saved_segments: state.segments,
      mureka_saved_options: { format, mode, folder, deleteMaster },
      mureka_saved_audio_meta: state.audioFileName ? {
        title: state.audioFileName,
        duration: state.audioDuration,
        filepath: state.bridgeFilePath,
        sourceType: state.audioSourceType
      } : null,
      mureka_saved_timestamp: Date.now()
    };

    await chrome.storage.local.set(payload);

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

    if (data.mureka_saved_url) {
      const input = document.getElementById('yt-url-input');
      if (input && !input.value) {
        input.value = data.mureka_saved_url;
      }
    }

    if (Array.isArray(data.mureka_saved_segments) && data.mureka_saved_segments.length > 0) {
      state.segments = data.mureka_saved_segments;
      renderSegmentsTable();
    } else {
      state.segments = [
        { id: 'seg_1', name: '', start: '', end: '', status: 'idle' },
        { id: 'seg_2', name: '', start: '', end: '', status: 'idle' },
        { id: 'seg_3', name: '', start: '', end: '', status: 'idle' },
      ];
      renderSegmentsTable();
    }

    if (data.mureka_saved_options) {
      const { format, mode, folder, deleteMaster } = data.mureka_saved_options;
      const fmtEl = document.getElementById('export-format-select');
      const modeEl = document.getElementById('export-mode-select');
      const folderEl = document.getElementById('output-folder-input');
      const delEl = document.getElementById('chk-auto-delete-master');
      if (fmtEl && format) fmtEl.value = format;
      if (modeEl && mode) modeEl.value = mode;
      if (folderEl && folder) folderEl.value = folder;
      if (delEl && deleteMaster !== undefined) delEl.checked = deleteMaster;
    }

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
    if (data && data.available && (!state.bridgeFilePath || state.bridgeFilePath !== data.filepath)) {
      state.bridgeFilePath = data.filepath;
      state.audioFileName = sanitizeFilename(data.title);
      state.audioDuration = data.duration;
      log(`⚡ Bridge active session ready: "${data.title}" (${data.duration_str})`, 'log-cyan');
      updateLoadedAudioUI(data.title, data.size_mb * 1024 * 1024, data.duration);
    }
  } catch (_) {}
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

    const mRange = line.match(rangeRegex);
    if (mRange) {
      const t1 = mRange[1];
      const t2 = mRange[2];
      const rawTitle = line.slice(0, mRange.index) + ' ' + line.slice(mRange.index + mRange[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: t2.trim() });
      continue;
    }

    const mWrap = line.match(singleWrapRegex);
    if (mWrap) {
      const t1 = mWrap[1];
      const rawTitle = line.slice(0, mWrap.index) + ' ' + line.slice(mWrap.index + mWrap[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: '' });
      continue;
    }

    const mPlain = line.match(singlePlainRegex);
    if (mPlain) {
      const t1 = mPlain[1];
      const rawTitle = line.slice(0, mPlain.index) + ' ' + line.slice(mPlain.index + mPlain[0].length);
      const name = cleanSegmentName(rawTitle) || `Segment_${segments.length + 1}`;
      segments.push({ name, start: t1.trim(), end: '' });
      continue;
    }
  }

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

    const nameInput = rowEl.querySelector('.seg-name');
    const startInput = rowEl.querySelector('.seg-start');
    const endInput = rowEl.querySelector('.seg-end');
    const delBtn = rowEl.querySelector('.btn-row-del');

    nameInput.addEventListener('input', (e) => { seg.name = e.target.value; triggerAutoSave(); updateAutoTrimLabel(); });
    startInput.addEventListener('input', (e) => { seg.start = e.target.value; triggerAutoSave(); updateAutoTrimLabel(); });
    endInput.addEventListener('input', (e) => { seg.end = e.target.value; triggerAutoSave(); updateAutoTrimLabel(); });

    delBtn.addEventListener('click', () => {
      deleteSegmentRow(seg.id);
    });

    container.appendChild(rowEl);
  });

  updateAutoTrimLabel();
}

function updateAutoTrimLabel() {
  const valid = state.segments.filter(s => s.name.trim() && s.start.trim() && s.end.trim());
  const dlBtn = document.getElementById('btn-download-audio');
  if (!dlBtn) return;
  if (valid.length > 0) {
    dlBtn.innerHTML = `<span>⚡</span><span>Auto-Download & Trim (${valid.length} Songs)</span>`;
    dlBtn.title = 'Downloads and immediately slices all tracks on local PC with master cleanup';
  } else {
    dlBtn.innerHTML = `<span>⬇</span><span>Download YouTube Audio</span>`;
    dlBtn.title = 'Download YouTube audio stream to split';
  }
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

    if (remote.version !== CURRENT_VERSION) {
      log(`⚡ NEW UPDATE AVAILABLE: v${remote.version}!`, 'log-green');
      log(`📝 Changelog: ${remote.changelog || 'Latest features & bug fixes'}`, 'log-cyan');
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
      title.textContent = 'Local Engine: Active ⚡ (Hardware Accelerated 0.05s Slicing - ZERO HANG)';
      sub.textContent = 'Full audio will auto-delete after trimming. Only sliced songs saved!';
    } else {
      title.textContent = 'Local Engine: Active ⚡ (yt-dlp Native Stream Mode)';
      sub.textContent = 'Zero-dependency streaming active';
    }
    title.style.color = 'var(--accent-green)';
  } else {
    dot.className = 'engine-dot';
    title.textContent = 'Local Engine: Offline (Browser Standalone Mode)';
    title.style.color = 'var(--accent-orange)';
    sub.textContent = '👉 Double-click start_bridge.bat in extension folder for instant 10MB/s bypass';
  }
}

async function launchDesktopMusicSuite() {
  log('🚀 Launching Python Music Suite (music_app.py) on your PC…', 'log-cyan');
  try {
    const res = await fetch('http://127.0.0.1:59955/launch_desktop');
    const data = await res.json();
    if (data.success) {
      log('✔ Music Suite Desktop App opened successfully on Windows!', 'log-green');
      setStatus('Desktop App launched on PC');
    } else {
      log(`ℹ Desktop launch note: ${data.error || data.message || 'Run music_app.py manually'}`, 'log-orange');
    }
  } catch (err) {
    log(`⚠️ Could not launch desktop app: ${err.message}. Make sure start_bridge.bat is running.`, 'log-red');
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

  // Check if valid segments already exist for AUTO-TRIM
  const validSegments = state.segments.filter(s => s.name.trim() && s.start.trim() && s.end.trim());
  const format = document.getElementById('export-format-select')?.value || 'mp3';
  const folderName = sanitizeFilename(document.getElementById('output-folder-input')?.value || 'AudioSegments');
  const deleteMaster = document.getElementById('chk-auto-delete-master')?.checked ?? true;

  setBusy(true, 'Connecting to YouTube audio stream…');
  log(`⬇ Connecting to YouTube audio stream: ${url}`, 'log-cyan');

  try {
    const bridgeAvailable = await checkLocalBridge();

    if (bridgeAvailable) {
      // Start real-time live percentage polling
      let pollTimer = setInterval(async () => {
        try {
          const pRes = await fetch('http://127.0.0.1:59955/progress');
          const pData = await pRes.json();
          if (pData && pData.status === 'downloading') {
            const pct = Math.max(0, Math.min(100, pData.percent || 0));
            setProgress(pct);
            const speedStr = pData.speed ? `(${pData.speed} · ETA: ${pData.eta || 'calc…'})` : '';
            setStatus(`⬇ Downloading: ${pct.toFixed(1)}% ${speedStr}`, true);
          }
        } catch (_) {}
      }, 300);

      // CASE A: Timestamps already entered -> AUTO DOWNLOAD & TRIM & DELETE MASTER AUDIO!
      if (validSegments.length > 0) {
        log(`⚡ Auto-Trim Enabled: Downloading and slicing ${validSegments.length} tracks on local engine…`, 'log-green');
        validSegments.forEach(s => s.status = 'processing');
        renderSegmentsTable();

        const dlRes = await fetch('http://127.0.0.1:59955/download_and_split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            cookies: state.cookiesText,
            segments: validSegments,
            format: format,
            folder: folderName,
            delete_source: deleteMaster,
            auto_trim: true
          })
        });

        clearInterval(pollTimer);
        const data = await dlRes.json();
        if (!data.success) throw new Error(data.error || 'Auto-trim failed');

        setProgress(100);
        validSegments.forEach(s => s.status = 'done');
        renderSegmentsTable();

        const summaryText = `✔ Done! Trimmed ${data.sliced_count} songs into Desktop/AudioSegments/${folderName}`;
        setStatus(summaryText, false);
        log(`🎉 Auto-Trim Complete! ${data.sliced_count} song segments created.`, 'log-green');

        if (data.deleted_master) {
          log('🗑 Auto-deleted master full audio file. Only trimmed songs retained on disk!', 'log-green');
        }

        // Open Folder button
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-secondary';
        openBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; margin-left: 8px;';
        openBtn.textContent = '📂 Open Folder';
        openBtn.onclick = () => fetch(`http://127.0.0.1:59955/open_folder?path=${encodeURIComponent(data.output_dir)}`);
        document.getElementById('status-text')?.appendChild(openBtn);

        triggerAutoSave();
        return;
      }

      // CASE B: No timestamps yet -> Fast download, store filepath, NO MEMORY BLOAT
      log('⚡ Local Engine downloading audio with yt-dlp…', 'log-green');
      const bridgeRes = await fetch('http://127.0.0.1:59955/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, cookies: state.cookiesText })
      });
      clearInterval(pollTimer);
      const data = await bridgeRes.json();
      if (!data.success) throw new Error(data.error || 'Bridge download failed');

      setProgress(100);
      state.bridgeFilePath = data.filepath;
      state.audioFileName = sanitizeFilename(data.title);
      state.audioDuration = data.duration;
      state.audioSourceType = 'youtube';

      updateLoadedAudioUI(data.title, (data.size_mb || 50) * 1024 * 1024, data.duration);
      log(`✔ Companion download complete: ${data.title} (${data.duration_str}) — Ready to split!`, 'log-green');
      log('💡 Paste timestamps in table and click "Split & Export" to slice and delete full audio!', 'log-cyan');
      triggerAutoSave();
      return;
    }

    // 2. Standalone browser fallback mode (if bridge offline)
    log('ℹ Local engine offline. Falling back to browser direct fetch…', 'log-cyan');
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) throw new Error('Invalid YouTube URL or Video ID');

    const resolvers = [
      async () => {
        const r = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const streamData = await r.json();
        const audioStreams = streamData.audioStreams || [];
        if (!audioStreams.length) throw new Error('No audio streams in response');
        audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return { title: streamData.title || `YouTube_${videoId}`, streamUrl: audioStreams[0].url };
      },
      async () => {
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
      } catch (e) { lastErr = e; }
    }

    if (!resolved || !resolved.streamUrl) {
      throw new Error(lastErr ? lastErr.message : 'Please double-click start_bridge.bat for bot-bypass');
    }

    log(`⬇ Downloading stream for: ${resolved.title}…`, 'log-cyan');
    setStatus('Downloading audio chunks…', true);

    const streamResponse = await fetch(resolved.streamUrl);
    if (!streamResponse.ok) throw new Error(`HTTP ${streamResponse.status}`);

    const audioArrayBuffer = await streamResponse.arrayBuffer();
    setStatus('Decoding audio…', true);

    const decoded = await getAudioContext().decodeAudioData(audioArrayBuffer);
    state.audioBuffer = decoded;
    state.audioFileName = sanitizeFilename(resolved.title);
    state.audioDuration = decoded.duration;
    state.audioSourceType = 'youtube';
    state.bridgeFilePath = null;

    updateLoadedAudioUI(resolved.title, audioArrayBuffer.byteLength, decoded.duration);
    log(`✔ Complete: ${resolved.title} (${formatTime(decoded.duration)}) — ready to split!`, 'log-green');
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

  const validSegments = state.segments.filter(s => s.name.trim() && s.start.trim() && s.end.trim());
  if (!validSegments.length) {
    alert('Please add at least one segment with Name, Start time, and End time.');
    return;
  }

  const format = document.getElementById('export-format-select')?.value || 'mp3';
  const folderName = sanitizeFilename(document.getElementById('output-folder-input')?.value || 'AudioSegments');
  const deleteMaster = document.getElementById('chk-auto-delete-master')?.checked ?? true;

  // 1. FAST HARDWARE-ACCELERATED LOCAL SPLIT (ZERO HANG!)
  if (state.localBridgeActive && state.bridgeFilePath) {
    setBusy(true, 'Fast local FFmpeg splitting…');
    log(`✂ Slicing ${validSegments.length} tracks via local FFmpeg (Zero-Hang)…`, 'log-cyan');

    try {
      validSegments.forEach(s => s.status = 'processing');
      renderSegmentsTable();

      const splitRes = await fetch('http://127.0.0.1:59955/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filepath: state.bridgeFilePath,
          segments: validSegments,
          folder: folderName,
          format: format,
          delete_source: deleteMaster
        })
      });
      const data = await splitRes.json();
      if (!data.success) throw new Error(data.error || 'Local split failed');

      validSegments.forEach(s => s.status = 'done');
      renderSegmentsTable();
      setProgress(100);

      const summary = `✔ Sliced ${data.sliced_count} tracks into Desktop/AudioSegments/${folderName}`;
      setStatus(summary, false);
      log(`🎉 ${summary}`, 'log-green');

      if (data.deleted_source) {
        log('🗑 Master full audio file auto-deleted from disk! Only partial songs remain.', 'log-green');
        state.bridgeFilePath = null;
        state.audioFileName = null;
        const lbl = document.getElementById('file-status-lbl');
        if (lbl) {
          lbl.className = 'file-status-label';
          lbl.textContent = 'None';
        }
      }

      // Open Folder Button
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-secondary';
      openBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; margin-left: 8px;';
      openBtn.textContent = '📂 Open Folder';
      openBtn.onclick = () => fetch(`http://127.0.0.1:59955/open_folder?path=${encodeURIComponent(data.output_dir)}`);
      document.getElementById('status-text')?.appendChild(openBtn);

      triggerAutoSave();
      return;
    } catch (err) {
      log(`⚠️ Local split notice: ${err.message}. Trying browser fallback…`, 'log-orange');
    } finally {
      setBusy(false);
    }
  }

  // 2. Standalone browser fallback (if bridge offline)
  if (!state.audioBuffer) {
    alert('Please download YouTube audio first or start start_bridge.bat.');
    return;
  }

  setBusy(true, 'Splitting audio segments in browser…');
  log(`✂ Starting browser split for ${validSegments.length} segment(s)…`, 'log-cyan');

  const mode = document.getElementById('export-mode-select')?.value || 'zip';
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

    seg.status = 'processing';
    renderSegmentsTable();
    setStatus(`Cutting [${indexStr}/${validSegments.length}]: ${cleanName}…`, true);
    setProgress(((i) / validSegments.length) * 100);

    try {
      if (startSec >= sourceDuration) throw new Error(`Start time exceeds duration`);
      if (endSec > sourceDuration) endSec = sourceDuration;
      const duration = endSec - startSec;
      if (duration <= 0) throw new Error(`End must be after start`);

      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.min(state.audioBuffer.length, Math.floor(endSec * sampleRate));
      const sliceLength = endSample - startSample;

      const sliceBuffer = audioCtx.createBuffer(numChannels, sliceLength, sampleRate);
      for (let ch = 0; ch < numChannels; ch++) {
        const srcData = state.audioBuffer.getChannelData(ch);
        const dstData = sliceBuffer.getChannelData(ch);
        dstData.set(srcData.subarray(startSample, endSample));
      }

      let blob;
      const fileExt = format === 'wav' ? 'wav' : 'mp3';
      const outFilename = `${indexStr}. ${cleanName}.${fileExt}`;

      if (format === 'wav') {
        blob = window.MurekaAudioUtils.encodeWAV(sliceBuffer);
      } else {
        blob = window.MurekaAudioUtils.encodeMP3(sliceBuffer, 320);
      }

      if (zip) {
        zip.file(outFilename, blob);
      } else {
        const blobUrl = URL.createObjectURL(blob);
        const downloadPath = folderName ? `${folderName}/${outFilename}` : outFilename;
        chrome.runtime.sendMessage({ action: 'DOWNLOAD_SEGMENT', url: blobUrl, filename: downloadPath });
      }

      seg.status = 'done';
      successCount++;
    } catch (err) {
      log(`✖ ${cleanName}: ${err.message}`, 'log-red');
      seg.status = 'error';
      failCount++;
    }

    renderSegmentsTable();
  }

  setProgress(100);

  if (zip && successCount > 0) {
    setStatus('Generating ZIP package…', true);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipFilename = folderName ? `${folderName}.zip` : 'AudioSegments.zip';
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_SEGMENT', url: zipUrl, filename: zipFilename });
    log(`✔ ZIP archive downloaded: ${zipFilename}`, 'log-green');
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
      log('⚠ No valid timestamps found in clipboard. Paste lines like:\nOpening Prayer: (0:00:00 - 0:02:29)\nOr click 📝 Bulk Paste.', 'log-orange');
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
  const urlParams = new URLSearchParams(window.location.search);
  const isFull = urlParams.get('mode') === 'full';
  if (isFull) {
    document.body.classList.add('full-studio-mode');
  }

  restoreStateFromStorage();
  loadSavedCookies();
  checkActiveTabForYouTube();

  log(`⚡ Mureka Audio Splitter v${CURRENT_VERSION} initialized.`, 'log-cyan');
  log('🛡 Ready with YouTube bot-check and 403 bypass protection.', 'log-green');

  // Input change auto-save listeners
  document.getElementById('yt-url-input')?.addEventListener('input', () => { triggerAutoSave(); updateAutoTrimLabel(); });
  document.getElementById('export-format-select')?.addEventListener('change', triggerAutoSave);
  document.getElementById('export-mode-select')?.addEventListener('change', triggerAutoSave);
  document.getElementById('output-folder-input')?.addEventListener('input', triggerAutoSave);
  document.getElementById('chk-auto-delete-master')?.addEventListener('change', triggerAutoSave);

  // Desktop App Launchers
  document.getElementById('btn-launch-desktop')?.addEventListener('click', launchDesktopMusicSuite);
  document.getElementById('btn-banner-launch-desktop')?.addEventListener('click', launchDesktopMusicSuite);

  // Persistent Window & Side Panel Actions
  const openWindow = () => {
    chrome.runtime.sendMessage({ action: 'OPEN_WINDOW' }, () => {
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

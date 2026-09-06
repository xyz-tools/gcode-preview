// GCode debugger — inspect what the parser makes of a gcode file and step
// through it command by command with breakpoints. The selected version runs
// in an iframe (own import map) that stays alive after loading: the full
// command list and the debug session's job live over there, and this page
// only ever receives summaries, row windows, and state snapshots. The iframe
// itself is visible in the right-hand panel as the live debug preview. The
// commands table is a virtual-scrolled list: a spacer sized total × row
// height, with only the visible rows (plus overscan) rendered, fetched from
// the runner in 200-row windows and cached per filter view.
//
// lib/runner-frame.js resolves on the first 'result' and stops listening, so
// it cannot serve follow-up page queries; this page manages its own iframe.
// Protocol (runner → parent / parent → runner):
//   'ready'                          → { type: 'load', gcode, settings, fallbackSettings }
//   { type: 'loaded', debuggable, firstCommandIndex, settingsError, settingsEcho, summary, histogram }
//   { type: 'apply-settings', settings } → { type: 'settings-applied', ok, message, echo } + a 'debug' stop
//   { type: 'query', offset, limit, filter } → { type: 'page', rows, total, offset, filter }
//   { type: 'debug-step' } | { type: 'debug-seek', index }
//   { type: 'debug-continue', breakpoints, toEnd }
//     → { type: 'progress', index, target } (during) and
//       { type: 'debug', index, total, command, state, derived, elapsedMs } (on stop)
//   { type: 'resize' } — nudge the renderer after the iframe gains real size
//   { type: 'unsupported', message } — version can't be inspected (2.x)
//   { type: 'error', message }

import { loadVersions, buildImportMap, populateVersionSelect, LOCAL_VERSION } from '../lib/versions.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';

// Nominal row height per the commands-table CSS. Sub-pixel table rendering
// (e.g. 28.5px at devicePixelRatio 2) would make the spacer math drift over
// 163k rows, so the first rendered row is measured and the real value adopted
// (see calibrateRowHeight).
let rowHeight = 28;
const WINDOW_SIZE = 200;
const OVERSCAN_ROWS = 10;
const LOAD_TIMEOUT_MS = 180_000;

const el = (id) => document.getElementById(id);
const statusEl = el('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const formatCount = (value) => value.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Iframe manager: one frame at a time, kept alive between queries.

let frame = null;

function teardownFrame() {
  if (!frame) return;
  window.removeEventListener('message', frame.onMessage);
  clearTimeout(frame.timeout);
  frame.iframe.remove();
  frame = null;
}

function spawnFrame(importMap, handlers) {
  teardownFrame();
  const iframe = document.createElement('iframe');
  const onMessage = (event) => {
    if (!frame || event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    // own-property guard: a type like '__proto__' must not dispatch into
    // Object.prototype (CodeQL: unvalidated dynamic method call)
    if (!Object.hasOwn(handlers, message.type)) return;
    handlers[message.type](message);
  };
  window.addEventListener('message', onMessage);

  const runnerUrl = new URL('runner.js', import.meta.url).href;
  iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">${JSON.stringify(importMap)}</script>
  <style>html, body { margin: 0; height: 100%; overflow: hidden; background: #0a0a0a; } canvas { width: 100%; height: 100%; display: block; }</style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module" src="${runnerUrl}"></script>
</body>
</html>`;
  el('frame-holder').replaceChildren(iframe);
  frame = { iframe, onMessage, timeout: undefined };
  return frame;
}

const post = (message) => frame?.iframe.contentWindow.postMessage(message, '*');

// ---------------------------------------------------------------------------
// Session persistence: the loaded source and the breakpoints survive reloads.
//
// One JSON blob under one key:
//   { version, source: { type:'preset', key } | { type:'text', text } | null,
//     breakpoints: number[], settingsOverride: string | null }
// settingsOverride is the raw settings-editor text (saved verbatim on every
// edit); a non-string or unparsable value is silently ignored at use time.
// source is null when the pasted text was too large to store. The debug
// position is deliberately not persisted. Storage is treated as hostile: a
// corrupt value is removed and ignored (this repo has shipped a
// localStorage-parse crash before), and a failed write never breaks the
// session (quota errors on big pasted text).

const STORAGE_KEY = 'gcode-preview-devtools:debugger';
const MAX_PERSIST_TEXT = 1_000_000;

// The source of the currently loaded session (null before the first
// successful load, or when the pasted text was too large to persist).
let session = null;
// Breakpoints read from storage, waiting for the restore-triggered load to
// succeed. Kept across a failed load so a retry can still apply them.
let pendingBreakpoints = null;

function readStoredState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    if (typeof state?.version !== 'string') throw new Error('bad version');
    const source = state.source;
    const sourceOk =
      source === null ||
      (source?.type === 'preset' && typeof source.key === 'string') ||
      (source?.type === 'text' && typeof source.text === 'string');
    if (!sourceOk) throw new Error('bad source');
    if (!Array.isArray(state.breakpoints) || !state.breakpoints.every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error('bad breakpoints');
    }
    // a bad override is dropped on its own rather than condemning the blob
    const settingsOverride = typeof state.settingsOverride === 'string' ? state.settingsOverride : null;
    // likewise for the column split: wrong type or out of range → default
    const splitPx =
      typeof state.splitPx === 'number' &&
      Number.isFinite(state.splitPx) &&
      state.splitPx >= 320 &&
      state.splitPx <= 4000
        ? state.splitPx
        : null;
    return { version: state.version, source, breakpoints: state.breakpoints, settingsOverride, splitPx };
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable; nothing to clean
    }
    return null;
  }
}

function persistState() {
  if (!session) return;
  const payload = {
    version: session.version,
    source: session.source,
    breakpoints: [...debug.breakpoints].sort((a, b) => a - b),
    settingsOverride: overrideText,
    splitPx
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or storage unavailable — the in-page session must go on
  }
}

// Re-selects the stored version and source and triggers a load. Runs once the
// version list is populated. The stored breakpoints are applied when that
// load's 'loaded' arrives; on load failure the key is left untouched so a
// retry (or the next reload) can still use it.
function restoreSession() {
  const stored = readStoredState();
  if (!stored) return;

  const versionSelect = el('version-select');
  const hasVersion = [...versionSelect.options].some((option) => option.value === stored.version);
  versionSelect.value = hasVersion ? stored.version : LOCAL_VERSION;

  pendingBreakpoints = stored.breakpoints;
  overrideText = stored.settingsOverride;
  if (!stored.source) return; // nothing auto-loadable was stored

  if (stored.source.type === 'preset') {
    const presetSelect = el('preset-select');
    if (![...presetSelect.options].some((option) => option.value === stored.source.key)) return;
    presetSelect.value = stored.source.key;
    el('gcode-text').value = '';
  } else {
    el('gcode-text').value = stored.source.text;
  }
  el('load-button').click();
}

// ---------------------------------------------------------------------------
// Resizable split between the commands list and the debug panel
//
// The drag handle drives the grid's --panel-w custom property. The value is
// persisted (splitPx in the storage blob) on drag end; double-click resets to
// the CSS default. Pointer capture keeps the drag alive across the preview
// iframe (whose pointer events are disabled while dragging).

const PANEL_MIN_PX = 320;
const COMMANDS_MIN_PX = 360;

let splitPx = readStoredState()?.splitPx ?? null;

function applySplit() {
  const grid = document.querySelector('.debugger-grid');
  if (splitPx === null) {
    grid.style.removeProperty('--panel-w');
  } else {
    grid.style.setProperty('--panel-w', `${splitPx}px`);
  }
}

function maxPanelWidth() {
  const grid = document.querySelector('.debugger-grid');
  // handle (8px) + two 0.75rem gaps ≈ 32px of non-column width
  return Math.max(PANEL_MIN_PX, grid.getBoundingClientRect().width - COMMANDS_MIN_PX - 32);
}

{
  const handle = el('split-handle');
  let drag = null;

  handle.addEventListener('pointerdown', (event) => {
    const panel = document.querySelector('.debug-panel');
    drag = { startX: event.clientX, startWidth: panel.getBoundingClientRect().width };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // capture is an optimization; a pointer id the browser doesn't track
      // (synthetic events) still gets move/up through the handle listeners
    }
    handle.classList.add('active');
    document.body.classList.add('dragging-split');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    // handle sits left of the panel: dragging left grows the panel
    const width = drag.startWidth + (drag.startX - event.clientX);
    splitPx = Math.round(Math.min(maxPanelWidth(), Math.max(PANEL_MIN_PX, width)));
    applySplit();
    renderVirtual(true);
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    handle.classList.remove('active');
    document.body.classList.remove('dragging-split');
    persistState();
    renderVirtual(true);
    post({ type: 'resize' }); // the preview canvas changed size
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  handle.addEventListener('dblclick', () => {
    splitPx = null;
    applySplit();
    persistState();
    renderVirtual(true);
    post({ type: 'resize' });
  });

  applySplit();
}

// ---------------------------------------------------------------------------
// Instantiation-settings editor
//
// The editor shows the full options object handed to the GCodePreview
// constructor (minus canvas). With no override it shows the current file's
// computed per-preset defaults; an override (raw editor text, persisted on
// every edit) wins verbatim at every instantiation until Reset.

// Computed defaults of the currently loaded file (set by loadFile).
let computedDefaults = null;
// Raw editor text override, or null when running on defaults. Initialized
// from storage so a manual load before restoreSession still honors it.
let overrideText = readStoredState()?.settingsOverride ?? null;

// Curated variants; each is the current file's defaults plus a small delta,
// so buildVolume/camera stay appropriate for the loaded gcode.
const SETTINGS_PRESETS = [
  { key: 'default', label: 'Default', delta: {} },
  { key: 'lines', label: 'Lines (no tubes)', delta: { renderTubes: false } },
  { key: 'tubes', label: 'Tubes (3D)', delta: { renderTubes: true } },
  { key: 'travel', label: 'Travel visible', delta: { renderTravel: true, travelColor: '#00ff00' } },
  { key: 'ortho', label: 'Orthographic camera', delta: { orthographic: true } },
  {
    key: 'contrast',
    label: 'High-contrast colors',
    delta: {
      backgroundColor: '#000000',
      extrusionColor: '#ffffff',
      topLayerColor: '#ff0080',
      lastSegmentColor: '#00ffff',
      renderTravel: true,
      travelColor: '#ffff00'
    }
  }
];

// Throws with a readable message when the text is not a settings object.
function parseSettingsText(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('settings must be a JSON object');
  }
  return value;
}

// The stored override as an object, or null when absent/unparsable (in which
// case instantiation silently uses the computed defaults).
function parsedOverride() {
  if (typeof overrideText !== 'string' || overrideText.trim() === '') return null;
  try {
    return parseSettingsText(overrideText);
  } catch {
    return null;
  }
}

function setValidation(message, kind) {
  const line = el('settings-validation');
  line.textContent = message;
  line.className = `settings-validation ${kind}`;
}

// Parses the editor text into the validation line; returns the object or null.
function refreshValidation() {
  try {
    const value = parseSettingsText(el('settings-json').value);
    setValidation('valid JSON — Apply rebuilds the session with it', 'valid');
    return value;
  } catch (error) {
    setValidation(String(error?.message ?? error), 'error');
    return null;
  }
}

function fillSettingsEditor() {
  el('settings-json').value = overrideText ?? JSON.stringify(computedDefaults, null, 2);
  refreshValidation();
}

function applySettingsToRunner(settings) {
  if (!debug.available || debug.busy) return;
  debug.busy = true;
  updateTransport();
  post({ type: 'apply-settings', settings });
}

function onSettingsApplied({ ok, message, echo }) {
  if (ok) {
    setValidation('applied — session rebuilt with these settings', 'valid');
  } else {
    setValidation(`constructor rejected: ${message} — reverted to last working settings`, 'error');
  }
  // echo of what the scene manager actually holds, inspectable via tooltip
  el('settings-validation').title = echo ? JSON.stringify(echo) : '';
}

let settingsDebounce;
el('settings-json').addEventListener('input', () => {
  clearTimeout(settingsDebounce);
  settingsDebounce = setTimeout(() => {
    overrideText = el('settings-json').value;
    refreshValidation();
    persistState();
  }, 300);
});

el('settings-apply').addEventListener('click', () => {
  const value = refreshValidation();
  if (!value) return;
  overrideText = el('settings-json').value;
  persistState();
  applySettingsToRunner(value);
});

el('settings-reset').addEventListener('click', () => {
  overrideText = null;
  persistState();
  fillSettingsEditor();
  if (computedDefaults) applySettingsToRunner(computedDefaults);
});

el('settings-preset').addEventListener('change', (event) => {
  const preset = SETTINGS_PRESETS.find((entry) => entry.key === event.target.value);
  event.target.value = ''; // snap back to the placeholder
  if (!preset || !computedDefaults) return;
  const merged = { ...computedDefaults, ...preset.delta };
  overrideText = JSON.stringify(merged, null, 2);
  el('settings-json').value = overrideText;
  refreshValidation();
  persistState();
  applySettingsToRunner(merged);
});

{
  const select = el('settings-preset');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'presets…';
  select.appendChild(placeholder);
  for (const { key, label } of SETTINGS_PRESETS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    select.appendChild(option);
  }
}

// ---------------------------------------------------------------------------
// Virtual-scrolled commands list

const browser = { loaded: false, filter: '' };

// Positions are indices into the CURRENT view (filtered or not); each cached
// row still carries its original command index. The cache is cleared whenever
// the filter changes or a new file loads.
const virtual = { total: 0, cache: new Map(), pending: new Set(), start: -1, end: -1 };

function clearVirtualData() {
  virtual.cache.clear();
  virtual.pending.clear();
  virtual.start = -1;
  virtual.end = -1;
}

// Changes the active filter view; returns whether it actually changed.
// Cached positions are meaningless across views, so the cache goes with it.
function setFilter(next) {
  if (next === browser.filter) return false;
  browser.filter = next;
  clearVirtualData();
  return true;
}

function updateSpacer() {
  el('commands-spacer').style.height = `${virtual.total * rowHeight}px`;
}

function updateFilterTotal() {
  el('filter-total').textContent = browser.filter
    ? `${formatCount(virtual.total)} command(s) match "${browser.filter}"`
    : `${formatCount(virtual.total)} commands`;
}

function requestWindow(offset) {
  if (!browser.loaded || virtual.pending.has(offset)) return;
  virtual.pending.add(offset);
  post({ type: 'query', offset, limit: WINDOW_SIZE, filter: browser.filter });
}

function rowHtml(row) {
  const isBreakpoint = debug.breakpoints.has(row.index);
  const classes = [isBreakpoint ? 'bp-row' : '', row.index === debug.index ? 'current-row' : '']
    .filter(Boolean)
    .join(' ');
  return `<tr${classes ? ` class="${classes}"` : ''}>
    <td class="col-bp${isBreakpoint ? ' bp-on' : ''}" data-index="${row.index}"
      title="toggle breakpoint on command ${formatCount(row.index)}"></td>
    <td class="col-index">${formatCount(row.index)}</td>
    <td>${escapeHtml(row.gcode)}</td>
    <td title="${escapeHtml(JSON.stringify(row.params))}">${escapeHtml(JSON.stringify(row.params))}</td>
    <td title="${escapeHtml(row.comment)}">${escapeHtml(row.comment)}</td>
    <td title="${escapeHtml(row.src)}">${escapeHtml(row.src)}</td>
  </tr>`;
}

const placeholderHtml = `<tr class="row-loading">
    <td class="col-bp"></td><td class="col-index">…</td><td></td><td colspan="3">loading…</td>
  </tr>`;

// Renders the visible window (plus overscan) of the virtual list, requesting
// any 200-row windows not yet cached. Cheap enough to run per animation
// frame while scrolling.
function renderVirtual(force = false) {
  if (!browser.loaded) return;
  const scroller = el('commands');
  const total = virtual.total;

  const first = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - OVERSCAN_ROWS);
  const last = Math.min(total - 1, Math.ceil((scroller.scrollTop + scroller.clientHeight) / rowHeight) + OVERSCAN_ROWS);
  if (!force && first === virtual.start && last === virtual.end) return;
  virtual.start = first;
  virtual.end = last;

  const rows = [];
  for (let position = first; position <= last; position++) {
    const windowOffset = Math.floor(position / WINDOW_SIZE) * WINDOW_SIZE;
    const row = virtual.cache.get(position);
    if (row) {
      rows.push(rowHtml(row));
    } else {
      requestWindow(windowOffset);
      rows.push(placeholderHtml);
    }
  }

  el('commands-body').style.top = `${first * rowHeight}px`;
  el('commands-rows').innerHTML = rows.join('');
  updateFilterTotal();
  calibrateRowHeight();
}

// Adopts the browser's actual rendered row height (sub-pixel table layout can
// differ from the nominal CSS value) so spacer size, window positions, and
// scroll targets stay exact across 163k rows.
function calibrateRowHeight() {
  const firstRow = el('commands-rows').querySelector('tr');
  if (!firstRow) return;
  const measured = firstRow.getBoundingClientRect().height;
  if (!measured || Math.abs(measured - rowHeight) < 0.25) return;
  rowHeight = measured;
  updateSpacer();
  renderVirtual(true);
}

function onPage({ rows, total, offset, filter }) {
  // A stale reply (the filter changed while the runner was working) belongs
  // to a dead view; its positions would corrupt the current cache.
  if (filter !== browser.filter) return;
  virtual.pending.delete(offset);
  if (total !== virtual.total) {
    virtual.total = total;
    updateSpacer();
  }
  rows.forEach((row, n) => virtual.cache.set(offset + n, row));
  renderVirtual(true);
}

// Centers the given view position in the scroll container.
function scrollToPosition(position) {
  const scroller = el('commands');
  const target = (position + 0.5) * rowHeight - scroller.clientHeight / 2;
  scroller.scrollTop = Math.max(0, target);
  renderVirtual(true);
}

let scrollScheduled = false;
el('commands').addEventListener('scroll', () => {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    renderVirtual();
  });
});

// ---------------------------------------------------------------------------
// Debug state

const debug = {
  available: false,
  busy: false,
  index: -1,
  total: 0,
  firstCommand: -1,
  breakpoints: new Set(),
  // previous combined state+derived snapshot, for changed-key highlighting
  snapshot: null
};

function updateTransport() {
  const gate = !debug.available || debug.busy;
  const atStart = debug.index <= -1;
  const atEnd = debug.index >= debug.total - 1;
  el('debug-reset').disabled = gate || atStart;
  el('debug-step-back').disabled = gate || atStart;
  el('debug-step').disabled = gate || atEnd;
  el('debug-continue').disabled = gate || atEnd;
  el('debug-run-first').disabled = gate || debug.firstCommand < 0;
  el('debug-run').disabled = gate || atEnd;
  // the settings editor rebuilds the session, so it shares the same gate
  el('settings-apply').disabled = gate;
  el('settings-reset').disabled = gate;
  el('settings-preset').disabled = gate;
}

function updateBreakpointButton() {
  const button = el('clear-breakpoints');
  const count = debug.breakpoints.size;
  button.style.display = count > 0 ? '' : 'none';
  button.textContent = `Clear breakpoints (${count})`;
}

function resetDebugPanel(message) {
  debug.available = false;
  debug.busy = false;
  debug.index = -1;
  debug.total = 0;
  debug.firstCommand = -1;
  debug.breakpoints.clear();
  debug.snapshot = null;
  el('debug-readout').textContent = message;
  el('state-panel').innerHTML = '';
  updateTransport();
  updateBreakpointButton();
}

function startDebugOp(message) {
  if (!debug.available || debug.busy) return;
  debug.busy = true;
  updateTransport();
  post(message);
}

function renderReadout({ index, total, command, elapsedMs }) {
  const readout = el('debug-readout');
  const position =
    index < 0
      ? `not started / ${formatCount(total)} commands`
      : `command ${formatCount(index)} / ${formatCount(total)}`;
  const elapsed = elapsedMs !== undefined ? ` (${formatCount(elapsedMs)} ms)` : '';
  const text = command
    ? command.src?.trim() || `${command.gcode} ${JSON.stringify(command.params)}`
    : 'initial state — nothing executed';
  readout.innerHTML = `${escapeHtml(position + elapsed)}<span class="debug-command" title="${escapeHtml(
    text
  )}">${escapeHtml(text)}</span>`;
}

const formatStateValue = (value) => {
  if (value === null) return 'undefined';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 1000) / 1000);
  return String(value);
};

function renderStatePanel({ state, derived }) {
  const snapshot = { ...state };
  for (const [key, value] of Object.entries(derived)) snapshot[`job.${key}`] = value;

  const previous = debug.snapshot;
  const row = (key, value, label = key) => {
    const changed = previous !== null && previous[key] !== value;
    return `<tr${changed ? ' class="changed"' : ''}><td>${escapeHtml(label)}</td><td>${escapeHtml(
      formatStateValue(value)
    )}</td></tr>`;
  };

  const stateRows = Object.entries(state).map(([key, value]) => row(key, value));
  const derivedRows = Object.entries(derived).map(([key, value]) => row(`job.${key}`, value, key));
  el('state-panel').innerHTML = `<table class="inspector-table state-table">
    <thead><tr><th>State</th><th>Value</th></tr></thead>
    <tbody>
      ${stateRows.join('')}
      <tr class="state-group"><td colspan="2">job</td></tr>
      ${derivedRows.join('')}
    </tbody>
  </table>`;

  debug.snapshot = snapshot;
}

// A completed debug operation: sync the panel, then scroll the unfiltered
// virtual list so the current command sits centered (clearing any filter —
// noted in the UI — so the highlighted row is actually in the view shown).
function onDebugStopped(message) {
  debug.busy = false;
  debug.index = message.index;
  debug.total = message.total;
  renderReadout(message);
  renderStatePanel(message);
  updateTransport();

  el('command-filter').value = '';
  if (setFilter('')) {
    virtual.total = debug.total;
    updateSpacer();
  }
  scrollToPosition(Math.max(0, message.index));
}

// ---------------------------------------------------------------------------
// Summary + histogram

const SUMMARY_ROWS = [
  { key: 'lines', label: 'Lines' },
  { key: 'commands', label: 'Commands' },
  { key: 'layers', label: 'Layers' },
  { key: 'paths', label: 'Paths' },
  { key: 'isPlanar', label: 'Planar' },
  { key: 'points', label: 'Points', stat: true },
  { key: 'extrusionDistance', label: 'Extrusion distance (mm)', stat: true },
  { key: 'retractions', label: 'Retractions', stat: true },
  { key: 'deretractions', label: 'Deretractions', stat: true },
  { key: 'feedrateChanges', label: 'Feedrate changes', stat: true },
  { key: 'others', label: 'Other zero-length moves', stat: true }
];

function formatSummaryValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? formatCount(value) : formatCount(Math.round(value * 100) / 100);
  }
  return value === undefined ? 'n/a' : String(value);
}

function renderSummary(summary) {
  const rows = SUMMARY_ROWS.map(({ key, label, stat }) => {
    const value = stat ? summary.stats?.[key] : summary[key];
    return `<tr><td>${label}</td><td>${escapeHtml(formatSummaryValue(value))}</td></tr>`;
  }).join('');
  el('summary').innerHTML = `<table class="inspector-table">
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderHistogram(histogram) {
  const rows = histogram
    .map(([gcode, count]) => `<tr><td>${escapeHtml(gcode)}</td><td>${formatCount(count)}</td></tr>`)
    .join('');
  el('histogram').innerHTML = `<table class="inspector-table">
    <thead><tr><th>gcode</th><th>count</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Loading

function finishLoad() {
  clearTimeout(frame?.timeout);
  el('load-button').disabled = false;
}

async function loadFile() {
  const version = el('version-select').value;
  const pasted = el('gcode-text').value.trim();
  const presetKey = el('preset-select').value;

  browser.loaded = false;
  browser.filter = el('command-filter').value.trim();
  clearVirtualData();
  virtual.total = 0;
  el('results').style.display = 'none';
  resetDebugPanel('Loading…');

  setStatus('Fetching gcode…');
  const gcode = pasted !== '' ? pasted : await fetchPresetGcode(presetKey);
  const source = pasted !== '' ? 'pasted gcode' : `preset "${presetKey}"`;
  // what (if anything) of this load can be stored for the next visit
  const persistableSource =
    pasted === ''
      ? { type: 'preset', key: presetKey }
      : pasted.length <= MAX_PERSIST_TEXT
        ? { type: 'text', text: pasted }
        : null;
  // SceneManager's constructor reads buildVolume.x, so pasted gcode (which has
  // no preset to supply one) still needs a build volume.
  const settings =
    pasted !== '' ? { backgroundColor: '#141414', buildVolume: { x: 200, y: 200, z: 0 } } : presetSettings(presetKey);
  computedDefaults = settings;
  // a stored override wins verbatim at every instantiation until Reset; the
  // computed defaults ride along as the constructor-failure fallback
  const override = parsedOverride();
  const effectiveSettings = override ?? settings;

  setStatus('Resolving version…');
  const importMap = await buildImportMap(version);

  setStatus(`Parsing ${source} with ${version}…`);
  spawnFrame(importMap, {
    ready: () =>
      post({ type: 'load', gcode, settings: effectiveSettings, fallbackSettings: override ? settings : undefined }),
    loaded: ({ summary, histogram, debuggable, firstCommandIndex, settingsError, settingsEcho }) => {
      finishLoad();
      browser.loaded = true;
      renderSummary(summary);
      renderHistogram(histogram);
      // collapsed by default; the content is one click away
      el('summary-section').open = false;
      el('histogram-section').open = false;
      el('results').style.display = '';
      const persistNote = persistableSource === null ? ' Pasted gcode too large to persist across reloads.' : '';
      setStatus(`Loaded ${source} with ${version} — ${formatCount(summary.commands)} commands.${persistNote}`);
      debug.available = Boolean(debuggable);
      debug.total = summary.commands;
      debug.firstCommand = firstCommandIndex ?? -1;
      // stored breakpoints from a previous visit apply to the first load that
      // succeeds after restore; indexes past this file's end are dropped
      if (pendingBreakpoints !== null) {
        for (const index of pendingBreakpoints) {
          if (index < summary.commands) debug.breakpoints.add(index);
        }
        pendingBreakpoints = null;
        updateBreakpointButton();
      }
      session = { version, source: persistableSource };
      persistState();
      if (!debuggable) {
        el('debug-readout').textContent =
          'This build does not expose the interpreter — debugging needs the local build (or a version that does).';
      }
      updateTransport();
      fillSettingsEditor();
      if (settingsError) {
        setValidation(`stored settings rejected by constructor: ${settingsError} — defaults used`, 'error');
      }
      el('settings-validation').title = settingsEcho ? JSON.stringify(settingsEcho) : '';
      virtual.total = summary.commands;
      updateSpacer();
      el('commands').scrollTop = 0;
      renderVirtual(true);
      // the iframe was 0×0 while #results was hidden; after layout, tell the
      // renderer its canvas has a real size now
      requestAnimationFrame(() => post({ type: 'resize' }));
    },
    'settings-applied': (message) => onSettingsApplied(message),
    page: (message) => onPage(message),
    debug: (message) => onDebugStopped(message),
    progress: ({ index, target }) => {
      el('debug-readout').textContent = `running… ${formatCount(index)} / ${formatCount(target)}`;
    },
    unsupported: ({ message }) => {
      finishLoad();
      teardownFrame();
      resetDebugPanel('No file loaded.');
      setStatus(message);
    },
    error: ({ message }) => {
      finishLoad();
      teardownFrame();
      resetDebugPanel('No file loaded.');
      setStatus(`Load failed: ${message}`, true);
    }
  });
  frame.timeout = setTimeout(() => {
    finishLoad();
    teardownFrame();
    resetDebugPanel('No file loaded.');
    setStatus('Load timed out.', true);
  }, LOAD_TIMEOUT_MS);
}

el('load-button').addEventListener('click', async () => {
  const button = el('load-button');
  button.disabled = true;
  try {
    await loadFile();
  } catch (error) {
    console.error(error);
    teardownFrame();
    setStatus(`Load failed: ${error.message}`, true);
    button.disabled = false;
  }
});

let filterDebounce;
el('command-filter').addEventListener('input', (event) => {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(() => {
    if (!setFilter(event.target.value.trim())) return;
    el('commands').scrollTop = 0;
    renderVirtual(true);
  }, 250);
});

// ---------------------------------------------------------------------------
// Debugger wiring

el('debug-reset').addEventListener('click', () => startDebugOp({ type: 'debug-seek', index: -1 }));
el('debug-step-back').addEventListener('click', () => startDebugOp({ type: 'debug-seek', index: debug.index - 1 }));
el('debug-step').addEventListener('click', () => startDebugOp({ type: 'debug-step' }));
el('debug-continue').addEventListener('click', () =>
  startDebugOp({ type: 'debug-continue', breakpoints: [...debug.breakpoints], toEnd: false })
);
el('debug-run-first').addEventListener('click', () => startDebugOp({ type: 'debug-seek', index: debug.firstCommand }));
el('debug-run').addEventListener('click', () => startDebugOp({ type: 'debug-continue', breakpoints: [], toEnd: true }));

el('clear-breakpoints').addEventListener('click', () => {
  debug.breakpoints.clear();
  updateBreakpointButton();
  renderVirtual(true);
  persistState();
});

el('commands').addEventListener('click', (event) => {
  const cell = event.target.closest('td.col-bp');
  if (!cell) return;
  const index = Number(cell.dataset.index);
  if (!Number.isInteger(index)) return;
  if (debug.breakpoints.has(index)) {
    debug.breakpoints.delete(index);
  } else {
    debug.breakpoints.add(index);
  }
  updateBreakpointButton();
  renderVirtual(true);
  persistState();
});

populatePresetSelect(el('preset-select'), 'mach3');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-select'), versions, LOCAL_VERSION);
  restoreSession();
});

// Parser / interpreter inspector — see exactly what the parser makes of a
// gcode file. The selected version runs in a hidden iframe (own import map)
// that stays alive after loading, so the full command list lives over there
// and this page only ever receives summaries and 200-row pages.
//
// lib/runner-frame.js resolves on the first 'result' and stops listening, so
// it cannot serve follow-up page queries; this page manages its own iframe.
// Protocol (runner → parent / parent → runner):
//   'ready'                          → { type: 'load', gcode, settings }
//   { type: 'loaded', summary, histogram }
//   { type: 'query', offset, limit, filter } → { type: 'page', rows, total, offset, filter }
//   { type: 'unsupported', message } — version can't be inspected (2.x)
//   { type: 'error', message }

import { loadVersions, buildImportMap, populateVersionSelect, LOCAL_VERSION } from '../lib/versions.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';

const PAGE_SIZE = 200;
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
    handlers[message.type]?.(message);
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
// Browser state

let browser = { loaded: false, offset: 0, filter: '', total: 0 };

function requestPage() {
  if (!browser.loaded) return;
  post({ type: 'query', offset: browser.offset, limit: PAGE_SIZE, filter: browser.filter });
}

// ---------------------------------------------------------------------------
// Rendering

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

function renderPage({ rows, total, offset, filter }) {
  // A stale reply (filter or page changed while the runner was working) would
  // paint the wrong view; drop it, the current query's reply is on its way.
  if (filter !== browser.filter || offset !== browser.offset) return;
  browser.total = total;

  const bodyRows = rows
    .map(
      (row) => `<tr>
      <td class="col-index">${formatCount(row.index)}</td>
      <td>${escapeHtml(row.gcode)}</td>
      <td title="${escapeHtml(JSON.stringify(row.params))}">${escapeHtml(JSON.stringify(row.params))}</td>
      <td title="${escapeHtml(row.comment)}">${escapeHtml(row.comment)}</td>
      <td title="${escapeHtml(row.src)}">${escapeHtml(row.src)}</td>
    </tr>`
    )
    .join('');
  el('commands').innerHTML = `<table class="inspector-table commands-table">
    <thead><tr><th>#</th><th>gcode</th><th>params</th><th>comment</th><th>src</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  el('page-label').textContent = `page ${page} of ${formatCount(pageCount)}`;
  el('page-prev').disabled = offset === 0;
  el('page-next').disabled = offset + PAGE_SIZE >= total;
  el('filter-total').textContent = filter
    ? `${formatCount(total)} command(s) match "${filter}"`
    : `${formatCount(total)} commands`;
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

  browser = { loaded: false, offset: 0, filter: el('command-filter').value.trim(), total: 0 };
  el('results').style.display = 'none';

  setStatus('Fetching gcode…');
  const gcode = pasted !== '' ? pasted : await fetchPresetGcode(presetKey);
  const source = pasted !== '' ? 'pasted gcode' : `preset "${presetKey}"`;
  // SceneManager's constructor reads buildVolume.x, so pasted gcode (which has
  // no preset to supply one) still needs a build volume.
  const settings =
    pasted !== '' ? { backgroundColor: '#141414', buildVolume: { x: 200, y: 200, z: 0 } } : presetSettings(presetKey);

  setStatus('Resolving version…');
  const importMap = await buildImportMap(version);

  setStatus(`Parsing ${source} with ${version}…`);
  spawnFrame(importMap, {
    ready: () => post({ type: 'load', gcode, settings }),
    loaded: ({ summary, histogram }) => {
      finishLoad();
      browser.loaded = true;
      renderSummary(summary);
      renderHistogram(histogram);
      el('results').style.display = '';
      setStatus(`Loaded ${source} with ${version} — ${formatCount(summary.commands)} commands.`);
      requestPage();
    },
    page: (message) => renderPage(message),
    unsupported: ({ message }) => {
      finishLoad();
      teardownFrame();
      setStatus(message);
    },
    error: ({ message }) => {
      finishLoad();
      teardownFrame();
      setStatus(`Load failed: ${message}`, true);
    }
  });
  frame.timeout = setTimeout(() => {
    finishLoad();
    teardownFrame();
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

el('page-prev').addEventListener('click', () => {
  browser.offset = Math.max(0, browser.offset - PAGE_SIZE);
  requestPage();
});

el('page-next').addEventListener('click', () => {
  if (browser.offset + PAGE_SIZE >= browser.total) return;
  browser.offset += PAGE_SIZE;
  requestPage();
});

let filterDebounce;
el('command-filter').addEventListener('input', (event) => {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(() => {
    browser.filter = event.target.value.trim();
    browser.offset = 0;
    requestPage();
  }, 250);
});

populatePresetSelect(el('preset-select'), 'mach3');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-select'), versions, LOCAL_VERSION);
});

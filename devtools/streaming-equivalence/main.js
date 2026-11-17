import { loadVersions, buildImportMap, populateVersionSelect, LOCAL_VERSION } from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';
import { el, setStatus, escapeHtml, runWithButton } from '../lib/page.js';

const METRIC_LABELS = {
  lineCount: 'Lines parsed',
  layers: 'Layers',
  paths: 'Paths',
  isPlanar: 'Is planar',
  points: 'Points',
  extrusionDistance: 'Extrusion distance',
  retractions: 'Retractions',
  deretractions: 'Deretractions',
  feedrateChanges: 'Feedrate changes',
  others: 'Other zero-length moves',
  triangles: 'Triangles rendered'
};

// extrusionDistance legitimately accumulates float error across thousands of
// additions; round before comparing so only real divergence gets flagged.
const FLOAT_DECIMALS = 4;

function formatValue(value) {
  if (value === undefined) return 'n/a';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('en-US')
      : value.toLocaleString('en-US', { maximumFractionDigits: FLOAT_DECIMALS });
  }
  return String(value);
}

function valuesMatch(a, b) {
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    return a.toFixed(FLOAT_DECIMALS) === b.toFixed(FLOAT_DECIMALS);
  }
  return a === b;
}

function renderResults({ whole, streamed }) {
  const keys = [...new Set([...Object.keys(whole), ...Object.keys(streamed)])];
  const rows = keys.map((key) => ({
    label: METRIC_LABELS[key] ?? key,
    wholeText: formatValue(whole[key]),
    streamedText: formatValue(streamed[key]),
    match: valuesMatch(whole[key], streamed[key])
  }));
  const mismatches = rows.filter((row) => !row.match).length;

  const verdict =
    mismatches === 0
      ? `<div class="verdict ok">EQUIVALENT — all ${rows.length} metrics match</div>`
      : `<div class="verdict bad">${mismatches} mismatch(es) found</div>`;

  const bodyRows = rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.label)}</td>
      <td>${escapeHtml(row.wholeText)}</td>
      <td>${escapeHtml(row.streamedText)}</td>
      <td class="${row.match ? 'match-yes' : 'match-no'}">${row.match ? '✓' : '✗'}</td>
    </tr>`
    )
    .join('');

  el('results').innerHTML = `${verdict}
  <table class="bench-results">
    <thead>
      <tr>
        <th>Metric</th>
        <th>Whole string</th>
        <th>Streamed</th>
        <th>Match</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  return mismatches;
}

async function runCheck() {
  const version = el('version-select').value;
  const presetKey = el('gcode-select').value;
  const chunkSize = parseInt(el('chunk-size').value, 10);
  const settings = presetSettings(presetKey, { renderTubes: el('render-mode').value === 'tubes' });

  el('frame-label').textContent = version;
  el('results').innerHTML = '';

  setStatus('Fetching gcode…');
  const gcode = await fetchPresetGcode(presetKey);

  setStatus('Resolving version…');
  const importMap = await buildImportMap(version);

  const { whole, streamed, streamingSupported } = await runInIframe({
    holder: el('frame-holder'),
    importMap: importMap,
    runnerUrl: new URL('runner.js', import.meta.url).href,
    payload: { gcode, settings, chunkSize },
    onPhase: (phase) => setStatus(`${version}: ${phase}…`)
  });

  if (!streamingSupported) {
    el('results').innerHTML = `<div class="verdict unsupported">
      Streaming is not supported by gcode-preview ${escapeHtml(version)} — nothing to compare.
    </div>`;
    setStatus('Done — streaming unsupported in this version.');
    return;
  }

  const mismatches = renderResults({ whole, streamed });
  setStatus(
    mismatches === 0
      ? `Done — streamed parse matches whole-string parse (${chunkSize}-char chunks).`
      : `Done — found ${mismatches} mismatch(es); streamed parsing diverges from whole-string parsing.`
  );
}

runWithButton(el('run-check'), 'Check', runCheck);

populatePresetSelect(el('gcode-select'), 'benchy');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-select'), versions, LOCAL_VERSION);
});

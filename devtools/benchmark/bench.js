import { loadVersions, buildImportMap, populateVersionSelect, latestStable2, LOCAL_VERSION } from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';

const METRICS = [
  { key: 'parseMs', label: 'Parse time', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'renderMs', label: 'Geometry build + render time', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'firstRenderMs', label: 'Time to first render', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'fps', label: 'FPS while orbiting', unit: 'fps', better: 'higher', decimals: 1 },
  { key: 'peakHeapMB', label: 'Peak JS heap (delta)', unit: 'MB', better: 'lower', decimals: 1 },
  { key: 'triangles', label: 'Triangles', unit: '', better: 'lower', decimals: 0 },
  { key: 'drawCalls', label: 'Draw calls', unit: '', better: 'lower', decimals: 0 }
];

const el = (id) => document.getElementById(id);
const statusEl = el('status');

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregate(runs) {
  const result = {};
  for (const { key } of METRICS) {
    result[key] = median(runs.map((run) => run[key]));
  }
  return result;
}

function formatValue(value, metric) {
  if (value === undefined) return 'n/a';
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: metric.decimals,
    maximumFractionDigits: metric.decimals
  });
  return metric.unit ? `${formatted} ${metric.unit}` : formatted;
}

function computeRows(aggregateA, aggregateB) {
  return METRICS.map((metric) => {
    const a = aggregateA[metric.key];
    const b = aggregateB[metric.key];
    const delta = a !== undefined && b !== undefined && a !== 0 ? ((b - a) / a) * 100 : undefined;
    const improved = delta !== undefined && (metric.better === 'higher' ? delta > 0 : delta < 0);
    return {
      metric,
      a,
      b,
      aText: formatValue(a, metric),
      bText: formatValue(b, metric),
      deltaText: delta === undefined ? 'n/a' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
      deltaClass: delta === undefined || Math.abs(delta) < 2 ? '' : improved ? 'delta-better' : 'delta-worse'
    };
  });
}

function headers(labelA, labelB, runCount) {
  return [`Metric (median of ${runCount})`, `A: ${labelA}`, `B: ${labelB}`, 'B vs A'];
}

function toCsv(rows, labelA, labelB, runCount) {
  const escape = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [headers(labelA, labelB, runCount)];
  for (const { metric, a, b, deltaText } of rows) {
    const label = metric.unit ? `${metric.label} (${metric.unit})` : metric.label;
    const raw = (value) => (value === undefined ? 'n/a' : value.toFixed(metric.decimals));
    lines.push([label, raw(a), raw(b), deltaText]);
  }
  return lines.map((cells) => cells.map(escape).join(',')).join('\n');
}

function toMarkdown(rows, labelA, labelB, runCount) {
  const lines = [
    `| ${headers(labelA, labelB, runCount).join(' | ')} |`,
    '| --- | ---: | ---: | ---: |',
    ...rows.map(({ metric, aText, bText, deltaText }) => `| ${metric.label} | ${aText} | ${bText} | ${deltaText} |`)
  ];
  return lines.join('\n');
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Copied ✓';
    setTimeout(() => (button.textContent = original), 1500);
  } catch (error) {
    console.error(error);
    setStatus(`Could not copy to clipboard: ${error.message}`, true);
  }
}

function renderResults(labelA, labelB, aggregateA, aggregateB, runCount) {
  const rows = computeRows(aggregateA, aggregateB);
  const [metricHeader, headerA, headerB, headerDelta] = headers(labelA, labelB, runCount);

  const bodyRows = rows
    .map(
      ({ metric, aText, bText, deltaText, deltaClass }) => `<tr>
      <td>${escapeHtml(metric.label)}</td>
      <td>${escapeHtml(aText)}</td>
      <td>${escapeHtml(bText)}</td>
      <td class="${deltaClass}">${escapeHtml(deltaText)}</td>
    </tr>`
    )
    .join('');

  el('results').innerHTML = `<table class="bench-results">
    <thead>
      <tr>
        <th>${escapeHtml(metricHeader)}</th>
        <th>${escapeHtml(headerA)}</th>
        <th>${escapeHtml(headerB)}</th>
        <th>${escapeHtml(headerDelta)}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="bench-export">
    <button id="copy-csv" class="bench-copy">Copy CSV</button>
    <button id="copy-markdown" class="bench-copy">Copy Markdown</button>
  </div>`;

  el('copy-csv').addEventListener('click', (event) =>
    copyToClipboard(toCsv(rows, labelA, labelB, runCount), event.currentTarget)
  );
  el('copy-markdown').addEventListener('click', (event) =>
    copyToClipboard(toMarkdown(rows, labelA, labelB, runCount), event.currentTarget)
  );
}

async function runBenchmark() {
  const versionA = el('version-a').value;
  const versionB = el('version-b').value;
  const presetKey = el('gcode-select').value;
  const runCount = parseInt(el('run-count').value, 10);
  const settings = presetSettings(presetKey, { renderTubes: el('render-mode').value === 'tubes' });

  el('label-a').textContent = versionA;
  el('label-b').textContent = versionB;
  el('results').innerHTML = '';

  setStatus('Fetching gcode…');
  const gcode = await fetchPresetGcode(presetKey);

  setStatus('Resolving versions…');
  const [importMapA, importMapB] = await Promise.all([buildImportMap(versionA), buildImportMap(versionB)]);

  const runnerUrl = new URL('runner.js', import.meta.url).href;
  const sides = [
    { label: `A (${versionA})`, importMap: importMapA, holder: el('frame-a'), runs: [] },
    { label: `B (${versionB})`, importMap: importMapB, holder: el('frame-b'), runs: [] }
  ];

  // Interleave A/B runs so machine warm-up and background noise hit both sides evenly.
  for (let run = 1; run <= runCount; run++) {
    for (const side of sides) {
      const progress = `run ${run}/${runCount} — ${side.label}`;
      setStatus(`${progress}: loading…`);
      const metrics = await runInIframe({
        holder: side.holder,
        importMap: side.importMap,
        runnerUrl,
        payload: { gcode, settings },
        onPhase: (phase) => setStatus(`${progress}: ${phase}…`)
      });
      side.runs.push(metrics);
      // Give the browser a moment to settle (GC, GPU teardown) between runs.
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  renderResults(versionA, versionB, aggregate(sides[0].runs), aggregate(sides[1].runs), runCount);
  setStatus(`Done — ${runCount} run(s) each, medians below.`);
}

el('run-benchmark').addEventListener('click', async () => {
  const button = el('run-benchmark');
  button.disabled = true;
  try {
    await runBenchmark();
  } catch (error) {
    console.error(error);
    setStatus(`Benchmark failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

populatePresetSelect(el('gcode-select'));
loadVersions().then((versions) => {
  populateVersionSelect(el('version-a'), versions, latestStable2(versions) ?? versions[0]);
  populateVersionSelect(el('version-b'), versions, LOCAL_VERSION);
});

// Served alongside the demo (see devtools/README.md): the demo is the server
// root, so its preset catalog, gcodes, and library builds are one fetch away.
import { presets } from '/js/presets.js';
import { defaultSettings } from '/js/default-settings.js';

// Preset keys that affect what geometry gets built and where the camera sits.
// Sourced from defaultSettings + the selected preset (like the demo does), and
// sent identically to both versions so the comparison stays fair.
const RUNNER_SETTING_KEYS = [
  'buildVolume',
  'initialCameraPosition',
  'lineWidth',
  'lineHeight',
  'extrusionWidth',
  'minLayerThreshold',
  'renderExtrusion',
  'renderTravel',
  'travelColor'
];

const CDN = 'https://cdn.jsdelivr.net/npm';
const CDN_API = 'https://data.jsdelivr.com/v1/packages/npm';
const LOCAL_VERSION = 'local';
const RUN_TIMEOUT_MS = 180_000;

// Known versions, used when the jsDelivr API is unreachable.
const FALLBACK_VERSIONS = ['3.0.0-alpha.5', '2.18.0', '2.17.0', '2.16.0', '2.15.0'];

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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

async function loadVersions() {
  try {
    const data = await fetchJson(`${CDN_API}/gcode-preview`);
    return data.versions.map((v) => v.version);
  } catch (error) {
    console.warn('Could not list versions from jsDelivr, using fallback list', error);
    return FALLBACK_VERSIONS;
  }
}

function populateVersionSelects(versions) {
  const options = [
    { value: LOCAL_VERSION, label: 'local build (this checkout)' },
    ...versions.map((v) => ({ value: v, label: v }))
  ];
  for (const select of [el('version-a'), el('version-b')]) {
    for (const { value, label } of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }
  // Default to the release-gate comparison: latest stable 2.x vs the local 3.0 build.
  const latestStable2 = versions.find((v) => v.startsWith('2.') && !v.includes('-'));
  el('version-a').value = latestStable2 ?? versions[0];
  el('version-b').value = LOCAL_VERSION;
}

function populateGcodeSelect() {
  const select = el('gcode-select');
  for (const [key, preset] of Object.entries(presets)) {
    if (!preset.file) continue;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.title ?? key;
    select.appendChild(option);
  }
}

async function buildImportMap(version) {
  if (version === LOCAL_VERSION) {
    return {
      imports: {
        'gcode-preview': new URL('/dist/gcode-preview.es.js', document.baseURI).href,
        three: new URL('/lib/three/build/three.module.min.js', document.baseURI).href,
        'lil-gui': new URL('/lib/lil-gui/dist/lil-gui.esm.min.js', document.baseURI).href
      }
    };
  }

  const pkg = await fetchJson(`${CDN}/gcode-preview@${version}/package.json`);
  const entry = pkg.module ?? pkg.main ?? 'dist/gcode-preview.es.js';
  const imports = { 'gcode-preview': `${CDN}/gcode-preview@${version}/${entry}` };

  // Resolve the version's own three/lil-gui ranges so each side runs against
  // the dependencies it was published for.
  const deps = { ...pkg.peerDependencies, ...pkg.dependencies };
  const paths = {
    three: (v) => `${CDN}/three@${v}/build/three.module.js`,
    'lil-gui': (v) => `${CDN}/lil-gui@${v}/dist/lil-gui.esm.min.js`
  };
  for (const dep of Object.keys(paths)) {
    if (!deps[dep]) continue;
    const resolved = await fetchJson(`${CDN_API}/${dep}/resolved?specifier=${encodeURIComponent(deps[dep])}`);
    imports[dep] = paths[dep](resolved.version);
  }
  return { imports };
}

function runnerHtml(importMap) {
  const runnerUrl = new URL('runner.js', import.meta.url).href;
  return `<!DOCTYPE html>
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
}

function runInIframe(holder, importMap, payload, onPhase) {
  return new Promise((resolve, reject) => {
    holder.replaceChildren();
    const iframe = document.createElement('iframe');
    let settled = false;

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('benchmark run timed out')));
    }, RUN_TIMEOUT_MS);

    const finish = (settle) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      settle();
    };

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      switch (message.type) {
        case 'ready':
          iframe.contentWindow.postMessage({ type: 'run', ...payload }, '*');
          break;
        case 'phase':
          onPhase?.(message.phase);
          break;
        case 'result':
          finish(() => resolve(message.metrics));
          break;
        case 'error':
          finish(() => reject(new Error(message.message)));
          break;
      }
    };

    window.addEventListener('message', onMessage);
    iframe.srcdoc = runnerHtml(importMap);
    holder.appendChild(iframe);
  });
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
      <td>${metric.label}</td>
      <td>${aText}</td>
      <td>${bText}</td>
      <td class="${deltaClass}">${deltaText}</td>
    </tr>`
    )
    .join('');

  el('results').innerHTML = `<table class="bench-results">
    <thead>
      <tr>
        <th>${metricHeader}</th>
        <th>${headerA}</th>
        <th>${headerB}</th>
        <th>${headerDelta}</th>
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
  const preset = presets[el('gcode-select').value];
  // Preset files are demo-root-relative ('gcodes/…') or absolute URLs.
  const file = /^https?:\/\//.test(preset.file) ? preset.file : `/${preset.file}`;
  const runCount = parseInt(el('run-count').value, 10);

  const settings = { renderTubes: el('render-mode').value === 'tubes', backgroundColor: '#141414' };
  for (const key of RUNNER_SETTING_KEYS) {
    const value = preset[key] ?? defaultSettings[key];
    if (value !== undefined) settings[key] = value;
  }

  el('label-a').textContent = versionA;
  el('label-b').textContent = versionB;
  el('results').innerHTML = '';

  setStatus(`Fetching ${file}…`);
  const response = await fetch(file);
  if (!response.ok) throw new Error(`could not fetch ${file} (${response.status})`);
  const gcode = await response.text();

  setStatus('Resolving versions…');
  const [importMapA, importMapB] = await Promise.all([buildImportMap(versionA), buildImportMap(versionB)]);

  const sides = [
    { label: `A (${versionA})`, importMap: importMapA, holder: el('frame-a'), runs: [] },
    { label: `B (${versionB})`, importMap: importMapB, holder: el('frame-b'), runs: [] }
  ];

  // Interleave A/B runs so machine warm-up and background noise hit both sides evenly.
  for (let run = 1; run <= runCount; run++) {
    for (const side of sides) {
      const progress = `run ${run}/${runCount} — ${side.label}`;
      setStatus(`${progress}: loading…`);
      const metrics = await runInIframe(side.holder, side.importMap, { gcode, settings }, (phase) => {
        setStatus(`${progress}: ${phase}…`);
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

populateGcodeSelect();
loadVersions().then(populateVersionSelects);

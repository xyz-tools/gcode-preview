import { presets } from '../presets.js';

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
    option.value = preset.file;
    option.textContent = preset.title ?? key;
    select.appendChild(option);
  }
}

async function buildImportMap(version) {
  if (version === LOCAL_VERSION) {
    return {
      imports: {
        'gcode-preview': new URL('dist/gcode-preview.es.js', document.baseURI).href,
        three: new URL('lib/three/build/three.module.min.js', document.baseURI).href,
        'lil-gui': new URL('lib/lil-gui/dist/lil-gui.esm.min.js', document.baseURI).href
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
  const runnerUrl = new URL('js/bench/runner.js', document.baseURI).href;
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

function renderResults(labelA, labelB, aggregateA, aggregateB, runCount) {
  const rows = METRICS.map((metric) => {
    const a = aggregateA[metric.key];
    const b = aggregateB[metric.key];
    let deltaCell = '<td>n/a</td>';
    if (a !== undefined && b !== undefined && a !== 0) {
      const delta = ((b - a) / a) * 100;
      const improved = metric.better === 'higher' ? delta > 0 : delta < 0;
      const cls = Math.abs(delta) < 2 ? '' : improved ? 'delta-better' : 'delta-worse';
      deltaCell = `<td class="${cls}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</td>`;
    }
    return `<tr>
      <td>${metric.label}</td>
      <td>${formatValue(a, metric)}</td>
      <td>${formatValue(b, metric)}</td>
      ${deltaCell}
    </tr>`;
  }).join('');

  el('results').innerHTML = `<table class="bench-results">
    <thead>
      <tr>
        <th>Metric (median of ${runCount})</th>
        <th>A: ${labelA}</th>
        <th>B: ${labelB}</th>
        <th>B vs A</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function runBenchmark() {
  const versionA = el('version-a').value;
  const versionB = el('version-b').value;
  const file = el('gcode-select').value;
  const renderTubes = el('render-mode').value === 'tubes';
  const runCount = parseInt(el('run-count').value, 10);

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
      const metrics = await runInIframe(side.holder, side.importMap, { gcode, renderTubes }, (phase) => {
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

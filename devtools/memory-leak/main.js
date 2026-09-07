import { loadVersions, buildImportMap, populateVersionSelect, LOCAL_VERSION } from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';
import { el, setStatus, median, runWithButton } from '../lib/page.js';

// Steady-state growth beyond max(10 MB, 5%) counts as a leak. Without a forced
// GC this honestly resolves leaks of roughly a MB per cycle and up; retained-
// geometry leaks are far bigger, and the post-dispose renderer residuals
// (see runner.js) catch dispose() leaking GPU resources directly.
const HEAP_GROWTH_ALLOWANCE_MB = 10;
const HEAP_GROWTH_ALLOWANCE_RATIO = 0.05;

// ---------------------------------------------------------------------------
// Chart — single-series line of heap MB per cycle on a plain 2D canvas.

// Colors resolve from the shared theme vars at DRAW time (getters), so a
// theme toggle just needs a redraw — see the 'devtools-themechange' listener.
const themeColor = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const CHART = {
  get surface() {
    return themeColor('--dt-chart-surface', '#141414');
  },
  get line() {
    return themeColor('--dt-chart-line', '#86d1da');
  },
  get grid() {
    return themeColor('--dt-chart-grid', '#2a444d');
  },
  get ink() {
    return themeColor('--dt-chart-text', '#dff4f5');
  },
  get muted() {
    return themeColor('--dt-text-muted', '#2c6f7f');
  },
  padding: { top: 14, right: 18, bottom: 26, left: 58 },
  height: 220
};

const chart = {
  canvas: el('heap-chart'),
  samples: [],
  totalCycles: 0,
  baselineHeapMB: undefined,
  points: [], // pixel positions of drawn samples, for hover
  hoverIndex: -1
};

function chartReset(totalCycles) {
  chart.samples = [];
  chart.totalCycles = totalCycles;
  chart.baselineHeapMB = undefined;
  chart.points = [];
  chart.hoverIndex = -1;
  el('chart-empty').style.display = '';
  chart.canvas.style.display = 'none';
}

function heapValues() {
  return chart.samples.map((s) => s.heapMB).filter((v) => Number.isFinite(v));
}

function drawChart() {
  const values = heapValues();
  if (values.length === 0) return;
  el('chart-empty').style.display = 'none';

  const canvas = chart.canvas;
  canvas.style.display = 'block';
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = CHART.height;
  // reassigning width/height clears the bitmap, so only resize when needed
  const bitmapWidth = Math.round(width * dpr);
  const bitmapHeight = Math.round(height * dpr);
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CHART.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px sans-serif';

  const { top, right, bottom, left } = CHART.padding;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const domainValues = Number.isFinite(chart.baselineHeapMB) ? [...values, chart.baselineHeapMB] : values;
  let yMin = Math.min(...domainValues);
  let yMax = Math.max(...domainValues);
  if (yMax - yMin < 1) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 0.5;
    yMax = mid + 0.5;
  }
  const ySpan = yMax - yMin;
  yMin -= ySpan * 0.08;
  yMax += ySpan * 0.08;

  const x = (cycle) =>
    chart.totalCycles > 1 ? left + ((cycle - 1) / (chart.totalCycles - 1)) * plotW : left + plotW / 2;
  const y = (value) => top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  // Recessive frame + horizontal gridlines at min/mid/max.
  ctx.strokeStyle = CHART.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, plotW, plotH);
  ctx.beginPath();
  ctx.moveTo(left, top + plotH / 2);
  ctx.lineTo(left + plotW, top + plotH / 2);
  ctx.stroke();

  // Axis labels: y min/mid/max, x first/last cycle.
  ctx.fillStyle = CHART.ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(yMax.toFixed(1), left - 6, top);
  ctx.fillText(((yMax + yMin) / 2).toFixed(1), left - 6, top + plotH / 2);
  ctx.fillText(yMin.toFixed(1), left - 6, top + plotH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('1', x(1), top + plotH + 6);
  if (chart.totalCycles > 1) ctx.fillText(String(chart.totalCycles), x(chart.totalCycles), top + plotH + 6);

  // Baseline reference (heap before cycle 1), dashed.
  if (Number.isFinite(chart.baselineHeapMB)) {
    const by = y(chart.baselineHeapMB);
    ctx.strokeStyle = CHART.muted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, by);
    ctx.lineTo(left + plotW, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CHART.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('baseline', left + 4, by - 2);
  }

  // The series: 2px line, small markers ringed with the surface color.
  const drawn = chart.samples.filter((s) => Number.isFinite(s.heapMB));
  chart.points = drawn.map((s) => ({ x: x(s.cycle), y: y(s.heapMB), sample: s }));

  ctx.strokeStyle = CHART.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  chart.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  for (const p of chart.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = CHART.line;
    ctx.fill();
    ctx.strokeStyle = CHART.surface;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Hover: crosshair + readout for the nearest sample.
  const hovered = chart.points[chart.hoverIndex];
  if (hovered) {
    ctx.strokeStyle = CHART.muted;
    ctx.beginPath();
    ctx.moveTo(hovered.x, top);
    ctx.lineTo(hovered.x, top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hovered.x, hovered.y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = CHART.ink;
    ctx.stroke();
    ctx.fillStyle = CHART.ink;
    ctx.textAlign = hovered.x > left + plotW / 2 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    const label = `cycle ${hovered.sample.cycle}: ${hovered.sample.heapMB.toFixed(1)} MB`;
    ctx.fillText(label, hovered.x + (hovered.x > left + plotW / 2 ? -8 : 8), top + 2);
  }
}

chart.canvas.addEventListener('mousemove', (event) => {
  if (chart.points.length === 0) return;
  const rect = chart.canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  let best = -1;
  let bestDist = 24;
  chart.points.forEach((p, i) => {
    const dist = Math.abs(p.x - mx);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  if (best !== chart.hoverIndex) {
    chart.hoverIndex = best;
    drawChart();
  }
});

chart.canvas.addEventListener('mouseleave', () => {
  if (chart.hoverIndex === -1) return;
  chart.hoverIndex = -1;
  drawChart();
});

// ---------------------------------------------------------------------------
// Results table

const format = (value, decimals = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : 'n/a';

function tableReset() {
  el('results').innerHTML = `<table class="bench-results">
    <thead>
      <tr>
        <th>Cycle</th>
        <th>Heap (MB)</th>
        <th>Geometries after dispose</th>
        <th>Textures after dispose</th>
        <th>Triangles</th>
      </tr>
    </thead>
    <tbody id="results-body"></tbody>
  </table>`;
}

function tableAppend(sample) {
  const row = document.createElement('tr');
  const cells = [
    String(sample.cycle),
    format(sample.heapMB, 1),
    format(sample.geometries),
    format(sample.textures),
    format(sample.triangles)
  ];
  for (const text of cells) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.appendChild(cell);
  }
  el('results-body').appendChild(row);
}

// ---------------------------------------------------------------------------
// Verdict. The heap under V8 is not monotonic: it warms up, jumps to a new
// plateau when the allocator grows its budget, and oscillates in a GC sawtooth
// — all of which make a raw slope fit cry wolf on healthy builds. Instead:
// skip the warm-up, then compare the median heap of the first vs second half
// of the steady-state cycles.

// The geometry/texture columns are post-dispose residuals from each cycle's
// own renderer (see runner.js): a correct dispose() drives them to 0, so any
// persistent residual is a direct "dispose() leaked GPU resources" signal.
function counterResidual(samples, key) {
  const points = samples.filter((s) => Number.isFinite(s[key]));
  if (points.length === 0) return null;
  const max = Math.max(...points.map((s) => s[key]));
  return max > 0 ? { max, last: points[points.length - 1][key] } : null;
}

function renderVerdict(samples) {
  const verdictEl = el('verdict');
  verdictEl.style.display = 'block';

  const heapPoints = samples.filter((s) => Number.isFinite(s.heapMB)).map((s) => ({ x: s.cycle, y: s.heapMB }));

  let cssClass;
  let text;
  const steady = heapPoints.slice(Math.min(heapPoints.length - 3, Math.max(2, Math.floor(heapPoints.length * 0.3))));
  if (heapPoints.length < 2) {
    cssClass = '';
    text =
      'Heap data unavailable (performance.memory is Chrome-only) — verdict based on post-dispose renderer residuals below.';
  } else if (steady.length < 3) {
    cssClass = '';
    text = 'Too few cycles for a heap verdict — run at least 5 cycles.';
  } else {
    const half = Math.floor(steady.length / 2);
    const firstMed = median(steady.slice(0, half).map((p) => p.y));
    const lastMed = median(steady.slice(-half).map((p) => p.y));
    const growth = lastMed - firstMed;
    const perCycle = growth / Math.max(1, steady[steady.length - 1].x - steady[0].x - half + 1);
    const range = `steady-state heap ${firstMed.toFixed(1)} → ${lastMed.toFixed(1)} MB`;
    if (growth <= Math.max(HEAP_GROWTH_ALLOWANCE_MB, firstMed * HEAP_GROWTH_ALLOWANCE_RATIO)) {
      cssClass = 'ok';
      text = `✓ No leak detected — ${range} (${growth >= 0 ? '+' : ''}${growth.toFixed(1)} MB).`;
    } else {
      cssClass = 'bad';
      text = `Heap growing — ${range} (+${growth.toFixed(1)} MB, ~${perCycle.toFixed(2)} MB/cycle) — possible leak.`;
    }
  }

  const notes = [];
  for (const key of ['geometries', 'textures']) {
    const residual = counterResidual(samples, key);
    if (residual) {
      notes.push(
        `${key} left allocated after dispose() — up to ${residual.max} per cycle (last cycle: ${residual.last}).`
      );
    }
  }

  verdictEl.className = `verdict ${notes.length > 0 ? 'bad' : cssClass}`.trim();
  verdictEl.textContent = text;
  for (const note of notes) {
    const span = document.createElement('span');
    span.className = 'verdict-note';
    span.textContent = note;
    verdictEl.appendChild(span);
  }
}

// ---------------------------------------------------------------------------
// Orchestration

async function runTest() {
  const version = el('version-select').value;
  const presetKey = el('gcode-select').value;
  const cycles = parseInt(el('cycle-count').value, 10);
  const settings = presetSettings(presetKey, { renderTubes: el('render-mode').value === 'tubes' });

  el('frame-label').textContent = version;
  el('verdict').style.display = 'none';
  chartReset(cycles);
  tableReset();
  drawChart();

  setStatus('Fetching gcode…');
  const gcode = await fetchPresetGcode(presetKey);

  setStatus('Resolving version…');
  const importMap = await buildImportMap(version);

  const { baselineHeapMB, samples } = await runInIframe({
    holder: el('frame-holder'),
    importMap,
    runnerUrl: new URL('runner.js', import.meta.url).href,
    payload: { gcode, settings, cycles },
    timeoutMs: 300_000,
    onPhase: (phase) => setStatus(`Running ${phase}…`),
    onProgress: (sample) => {
      chart.samples.push(sample);
      chart.baselineHeapMB ??= sample.baselineHeapMB;
      tableAppend(sample);
      drawChart();
      const heapText = Number.isFinite(sample.heapMB) ? `${sample.heapMB.toFixed(1)} MB heap` : 'heap n/a';
      setStatus(`Cycle ${sample.cycle}/${cycles} done — ${heapText}, ${sample.geometries} geometries residual.`);
    }
  });

  // the chart accumulated these via progress messages; the result payload is
  // the single source of truth for the verdict but must match what was drawn
  if (samples.length !== chart.samples.length) {
    chart.samples = samples;
    chart.baselineHeapMB = baselineHeapMB;
    drawChart();
  }
  renderVerdict(samples);
  setStatus(`Done — ${samples.length} cycles on ${version}.`);
}

runWithButton(el('run-test'), 'Memory-leak test', runTest);

window.addEventListener('resize', drawChart);
// an existing chart must flip its colors when the page theme changes
document.addEventListener('devtools-themechange', drawChart);

populatePresetSelect(el('gcode-select'), 'benchy');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-select'), versions, LOCAL_VERSION);
});

import { loadVersions, buildImportMap, populateVersionSelect, LOCAL_VERSION } from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';

// Steady-state growth beyond max(10 MB, 5%) counts as a leak. Without a forced
// GC this honestly resolves leaks of roughly a MB per cycle and up; retained-
// geometry leaks are far bigger, and the renderer counters catch structural
// cases regardless.
const HEAP_GROWTH_ALLOWANCE_MB = 10;
const HEAP_GROWTH_ALLOWANCE_RATIO = 0.05;
const COUNTER_SLOPE_LIMIT = 0.01; // geometries/textures per cycle

const el = (id) => document.getElementById(id);
const statusEl = el('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

// ---------------------------------------------------------------------------
// Chart — single-series line of heap MB per cycle on a plain 2D canvas.

const themeStyles = getComputedStyle(document.documentElement);
const theme = (step, fallback) => themeStyles.getPropertyValue(`--my-theme-${step}`).trim() || fallback;

const CHART = {
  surface: '#141414',
  line: theme(300, '#86d1da'),
  grid: theme(800, '#2a444d'),
  ink: theme(100, '#dff4f5'),
  muted: theme(600, '#2c6f7f'),
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
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

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
        <th>Geometries</th>
        <th>Textures</th>
        <th>Triangles</th>
      </tr>
    </thead>
    <tbody id="results-body"></tbody>
  </table>`;
}

function tableAppend(sample) {
  const row = document.createElement('tr');
  row.innerHTML = `<td>${sample.cycle}</td>
    <td>${format(sample.heapMB, 1)}</td>
    <td>${format(sample.geometries)}</td>
    <td>${format(sample.textures)}</td>
    <td>${format(sample.triangles)}</td>`;
  el('results-body').appendChild(row);
}

// ---------------------------------------------------------------------------
// Verdict. The heap under V8 is not monotonic: it warms up, jumps to a new
// plateau when the allocator grows its budget, and oscillates in a GC sawtooth
// — all of which make a raw slope fit cry wolf on healthy builds. Instead:
// skip the warm-up, then compare the median heap of the first vs second half
// of the steady-state cycles.

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function leastSquaresSlope(points) {
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.x - meanX) * (p.y - meanY);
    denominator += (p.x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function counterTrend(samples, key) {
  const points = samples.filter((s) => Number.isFinite(s[key])).map((s) => ({ x: s.cycle, y: s[key] }));
  if (points.length < 2) return null;
  const slope = leastSquaresSlope(points);
  const first = points[0].y;
  const last = points[points.length - 1].y;
  return slope > COUNTER_SLOPE_LIMIT && last > first ? { first, last } : null;
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
    text = 'Heap data unavailable (performance.memory is Chrome-only) — verdict based on renderer counters below.';
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
    const trend = counterTrend(samples, key);
    if (trend) notes.push(`${key} trending upward across cycles (${trend.first} → ${trend.last}).`);
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
      setStatus(`Cycle ${sample.cycle}/${cycles} done — ${heapText}, ${sample.geometries} geometries.`);
    }
  });

  chart.samples = samples;
  chart.baselineHeapMB = baselineHeapMB;
  drawChart();
  renderVerdict(samples);
  setStatus(`Done — ${samples.length} cycles on ${version}.`);
}

el('run-test').addEventListener('click', async () => {
  const button = el('run-test');
  button.disabled = true;
  try {
    await runTest();
  } catch (error) {
    console.error(error);
    setStatus(`Memory-leak test failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('resize', drawChart);

populatePresetSelect(el('gcode-select'), 'benchy');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-select'), versions, LOCAL_VERSION);
});

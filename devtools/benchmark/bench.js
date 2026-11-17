import {
  loadVersions,
  loadCommitBuilds,
  buildImportMap,
  populateVersionSelect,
  latestStable,
  commitValue,
  commitLabel,
  LOCAL_VERSION
} from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';
import { el, setStatus, escapeHtml, median, runWithButton } from '../lib/page.js';
import {
  loadHistory,
  upsertRun,
  removeRun,
  clearHistory,
  groupHistory,
  runKey,
  downloadFile,
  timestampSlug
} from '../lib/history.js';

const METRICS = [
  { key: 'parseMs', label: 'Parse time', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'renderMs', label: 'Geometry build + render time', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'firstRenderMs', label: 'Time to first render', unit: 'ms', better: 'lower', decimals: 0 },
  { key: 'fps', label: 'FPS while orbiting', unit: 'fps', better: 'higher', decimals: 1 },
  { key: 'peakHeapMB', label: 'Peak JS heap (delta)', unit: 'MB', better: 'lower', decimals: 1 },
  { key: 'triangles', label: 'Triangles', unit: '', better: 'lower', decimals: 0 },
  { key: 'drawCalls', label: 'Draw calls', unit: '', better: 'lower', decimals: 0 }
];

// Catalog from devtools/dist/index.json, keyed by the select value that
// refers to it, so a harvested run can carry its commit metadata.
let commitBuilds = [];
const buildsByValue = new Map();

let cancelRequested = false;
let running = false;

const mode = () => el('mode').value;

// The FPS phase is driven by requestAnimationFrame, which browsers stop
// servicing in a hidden tab — a sweep left in the background doesn't just run
// slowly, it sits on one build until the tab is looked at again.
function updateVisibilityWarning() {
  el('hidden-warning').hidden = !(running && document.hidden);
}

document.addEventListener('visibilitychange', updateVisibilityWarning);

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

// Percent change of `value` against `base`, plus how to color it: only moves
// of 2%+ get a verdict, the rest is machine noise.
function delta(base, value, metric) {
  if (base === undefined || value === undefined || base === 0) return { text: 'n/a', className: '' };
  const percent = ((value - base) / base) * 100;
  const improved = metric.better === 'higher' ? percent > 0 : percent < 0;
  return {
    text: `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`,
    className: Math.abs(percent) < 2 ? '' : improved ? 'delta-better' : 'delta-worse'
  };
}

const escapeCsv = (value) => (/[",\n]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
const toCsvText = (rows) => rows.map((cells) => cells.map(escapeCsv).join(',')).join('\n');
const rawValue = (value, metric) => (value === undefined ? 'n/a' : value.toFixed(metric.decimals));

// --- A/B comparison (two versions, interleaved) -----------------------------

function computeRows(aggregateA, aggregateB) {
  return METRICS.map((metric) => {
    const a = aggregateA[metric.key];
    const b = aggregateB[metric.key];
    const { text, className } = delta(a, b, metric);
    return {
      metric,
      a,
      b,
      aText: formatValue(a, metric),
      bText: formatValue(b, metric),
      deltaText: text,
      deltaClass: className
    };
  });
}

function headers(labelA, labelB, runCount) {
  return [`Metric (median of ${runCount})`, `A: ${labelA}`, `B: ${labelB}`, 'B vs A'];
}

function toCsv(rows, labelA, labelB, runCount) {
  const lines = [headers(labelA, labelB, runCount)];
  for (const { metric, a, b, deltaText } of rows) {
    const label = metric.unit ? `${metric.label} (${metric.unit})` : metric.label;
    lines.push([label, rawValue(a, metric), rawValue(b, metric), deltaText]);
  }
  return toCsvText(lines);
}

function toMarkdown(rows, labelA, labelB, runCount) {
  const lines = [
    `| ${headers(labelA, labelB, runCount).join(' | ')} |`,
    '| --- | ---: | ---: | ---: |',
    ...rows.map(({ metric, aText, bText, deltaText }) => `| ${metric.label} | ${aText} | ${bText} | ${deltaText} |`)
  ];
  return lines.join('\n');
}

// Per-button restore timers, so a re-click within the 1.5s window can clear
// the pending restore instead of racing it.
const copyRestoreTimers = new WeakMap();

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    // Capture the TRUE label exactly once — a second click while the button
    // still says "Copied ✓" must not adopt that as the label to restore.
    button.dataset.label ??= button.textContent;
    button.textContent = 'Copied ✓';
    clearTimeout(copyRestoreTimers.get(button));
    copyRestoreTimers.set(
      button,
      setTimeout(() => (button.textContent = button.dataset.label), 1500)
    );
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

// --- harvest history --------------------------------------------------------

const displayName = (entry) => entry.short ?? entry.version;

function historyCsv(entries) {
  const header = [
    'file',
    'geometry',
    'runs',
    'commit',
    'commit date',
    'subject',
    'version',
    'measured at',
    ...METRICS.map((metric) => (metric.unit ? `${metric.label} (${metric.unit})` : metric.label))
  ];
  const rows = groupHistory(entries).flatMap((group) =>
    group.runs.map((entry) => [
      group.preset,
      group.renderMode,
      group.runCount,
      displayName(entry),
      entry.date ?? '',
      entry.subject ?? '',
      entry.version,
      entry.at ?? '',
      ...METRICS.map((metric) => rawValue(entry.metrics[metric.key], metric))
    ])
  );
  return toCsvText([header, ...rows]);
}

function historyMarkdown(entries) {
  const blocks = groupHistory(entries).map((group) => {
    const baseline = group.runs[0];
    const head = `### ${group.preset} · ${group.renderMode} · median of ${group.runCount}`;
    const columns = ['Commit', 'Subject', ...METRICS.map((metric) => metric.label)];
    const rows = group.runs.map((entry) => {
      const cells = METRICS.map((metric) => {
        const value = formatValue(entry.metrics[metric.key], metric);
        if (entry === baseline) return value;
        const { text } = delta(baseline.metrics[metric.key], entry.metrics[metric.key], metric);
        return `${value} (${text})`;
      });
      return `| ${[displayName(entry), entry.subject ?? '', ...cells].join(' | ')} |`;
    });
    return [head, '', `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows].join('\n');
  });
  return blocks.join('\n\n');
}

function renderHistory() {
  const entries = loadHistory();
  const container = el('history');

  if (!entries.length) {
    container.innerHTML = '<p class="bench-note">No harvested runs yet. Pick a harvest mode above and run.</p>';
    return;
  }

  const tables = groupHistory(entries)
    .map((group) => {
      const baseline = group.runs[0];
      const headerCells = ['Commit', 'Subject', ...METRICS.map((metric) => metric.label), '']
        .map((label) => `<th>${escapeHtml(label)}</th>`)
        .join('');

      const bodyRows = group.runs
        .map((entry) => {
          const cells = METRICS.map((metric) => {
            const value = escapeHtml(formatValue(entry.metrics[metric.key], metric));
            if (entry === baseline) return `<td>${value}</td>`;
            const { text, className } = delta(baseline.metrics[metric.key], entry.metrics[metric.key], metric);
            return `<td>${value}<span class="delta ${className}">${escapeHtml(text)}</span></td>`;
          }).join('');
          const title = entry === baseline ? ' title="baseline for this group"' : '';
          return `<tr${title}>
            <td>${escapeHtml(displayName(entry))}</td>
            <td class="subject">${escapeHtml(entry.subject ?? entry.version)}</td>
            ${cells}
            <td><button class="row-remove" data-key="${escapeHtml(runKey(entry))}" title="Remove this run">×</button></td>
          </tr>`;
        })
        .join('');

      return `<h3 class="history-head">${escapeHtml(group.preset)} · ${escapeHtml(group.renderMode)} ·
        median of ${group.runCount} · ${group.runs.length} commit(s)</h3>
      <div class="history-scroll">
        <table class="bench-results bench-history">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
    })
    .join('');

  container.innerHTML = `${tables}
    <div class="bench-export">
      <button id="download-csv" class="bench-copy">Download CSV</button>
      <button id="download-json" class="bench-copy">Download JSON</button>
      <button id="copy-history-markdown" class="bench-copy">Copy Markdown</button>
      <button id="clear-history" class="bench-copy">Clear history</button>
    </div>
    <p class="bench-note">
      Percentages are against the first row of each group (the oldest commit measured).
      History lives in this browser's localStorage, so it survives reloads and checkouts —
      download it if you want it to survive clearing site data.
    </p>`;

  el('download-csv').addEventListener('click', () =>
    downloadFile(`gcode-preview-bench-${timestampSlug()}.csv`, historyCsv(entries), 'text/csv;charset=utf-8')
  );
  el('download-json').addEventListener('click', () =>
    downloadFile(
      `gcode-preview-bench-${timestampSlug()}.json`,
      JSON.stringify(entries, null, 2),
      'application/json;charset=utf-8'
    )
  );
  el('copy-history-markdown').addEventListener('click', (event) =>
    copyToClipboard(historyMarkdown(entries), event.currentTarget)
  );
  el('clear-history').addEventListener('click', () => {
    if (!confirm('Delete all harvested runs?')) return;
    clearHistory();
    renderHistory();
  });
  for (const button of container.querySelectorAll('.row-remove')) {
    button.addEventListener('click', () => {
      removeRun(button.dataset.key);
      renderHistory();
    });
  }
}

// --- running ----------------------------------------------------------------

// One version, `runCount` times in the same holder, reduced to medians.
async function measure({ version, holder, runCount, gcode, settings, progressPrefix }) {
  const importMap = await buildImportMap(version);
  const runs = [];
  for (let run = 1; run <= runCount; run++) {
    const progress = `${progressPrefix}run ${run}/${runCount}`;
    setStatus(`${progress}: loading…`);
    runs.push(
      await runInIframe({
        holder,
        importMap,
        runnerUrl: new URL('runner.js', import.meta.url).href,
        payload: { gcode, settings },
        onPhase: (phase) => setStatus(`${progress}: ${phase}…`)
      })
    );
    // Give the browser a moment to settle (GC, GPU teardown) between runs.
    await new Promise((r) => setTimeout(r, 500));
  }
  return aggregate(runs);
}

function entryFor(version, metrics, context) {
  const build = buildsByValue.get(version);
  return {
    version,
    short: build ? build.short : version === LOCAL_VERSION ? 'local' : version,
    sha: build?.sha,
    subject: build?.subject ?? (version === LOCAL_VERSION ? 'local build (this checkout)' : `npm ${version}`),
    date: build?.date,
    ...context,
    metrics,
    at: new Date().toISOString()
  };
}

async function runCompare({ gcode, settings, runCount }) {
  const versionA = el('version-a').value;
  const versionB = el('version-b').value;
  el('label-a').textContent = versionA;
  el('label-b').textContent = versionB;

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
      side.runs.push(
        await runInIframe({
          holder: side.holder,
          importMap: side.importMap,
          runnerUrl,
          payload: { gcode, settings },
          onPhase: (phase) => setStatus(`${progress}: ${phase}…`)
        })
      );
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  renderResults(versionA, versionB, aggregate(sides[0].runs), aggregate(sides[1].runs), runCount);
  setStatus(`Done — ${runCount} run(s) each, medians below.`);
}

// Measures a list of versions one after another, appending each to the history
// table as it lands — so an interrupted sweep still leaves usable numbers.
async function runHarvest(targets, { gcode, settings, runCount, context }) {
  const skipDone = el('skip-done').checked;
  const measured = new Set(
    loadHistory()
      .filter(
        (entry) =>
          entry.preset === context.preset && entry.renderMode === context.renderMode && entry.runCount === runCount
      )
      .map((entry) => entry.version)
  );
  const queue = skipDone ? targets.filter((version) => !measured.has(version)) : targets;

  if (!queue.length) {
    setStatus(`Nothing to do — all ${targets.length} target(s) already measured for these settings.`);
    return;
  }

  el('stop-sweep').hidden = false;
  el('label-a').textContent = '';
  try {
    for (const [i, version] of queue.entries()) {
      if (cancelRequested) {
        setStatus(`Stopped after ${i} of ${queue.length}. Results so far are in the history below.`);
        return;
      }
      const build = buildsByValue.get(version);
      el('label-a').textContent = build ? commitLabel(build) : version;
      const metrics = await measure({
        version,
        holder: el('frame-a'),
        runCount,
        gcode,
        settings,
        progressPrefix: `[${i + 1}/${queue.length}] ${build?.short ?? version} — `
      });
      upsertRun(entryFor(version, metrics, context));
      renderHistory();
    }
    const skipped = targets.length - queue.length;
    setStatus(`Done — ${queue.length} measured${skipped ? `, ${skipped} skipped (already in history)` : ''}.`);
  } finally {
    el('stop-sweep').hidden = true;
    cancelRequested = false;
  }
}

async function run() {
  running = true;
  updateVisibilityWarning();
  try {
    return await runSelectedMode();
  } finally {
    running = false;
    updateVisibilityWarning();
  }
}

async function runSelectedMode() {
  const presetKey = el('gcode-select').value;
  const renderMode = el('render-mode').value;
  const runCount = parseInt(el('run-count').value, 10);
  const settings = presetSettings(presetKey, { renderTubes: renderMode === 'tubes' });
  const context = { preset: presetKey, renderMode, runCount };

  el('results').innerHTML = '';
  setStatus('Fetching gcode…');
  const gcode = await fetchPresetGcode(presetKey);

  setStatus('Resolving versions…');
  if (mode() === 'compare') return runCompare({ gcode, settings, runCount });
  if (mode() === 'harvest') return runHarvest([el('version-a').value], { gcode, settings, runCount, context });

  if (!commitBuilds.length) {
    throw new Error('no commit builds found — run: node devtools/sweep/build-commits.mjs');
  }
  return runHarvest(commitBuilds.map(commitValue), { gcode, settings, runCount, context });
}

// --- wiring -----------------------------------------------------------------

function applyMode() {
  const current = mode();
  el('version-a-group').hidden = current === 'sweep';
  el('version-b-group').hidden = current !== 'compare';
  el('viewport-b').hidden = current !== 'compare';
  el('skip-done-group').hidden = current === 'compare';
  el('run-benchmark').textContent = { compare: 'Run benchmark', harvest: 'Harvest run', sweep: 'Sweep commits' }[
    current
  ];
  el('viewport-a-title').textContent = current === 'compare' ? 'Version A' : 'Measuring';
}

el('mode').addEventListener('change', applyMode);
el('stop-sweep').addEventListener('click', () => {
  cancelRequested = true;
  setStatus('Stopping after the current build…');
});

runWithButton(el('run-benchmark'), 'Benchmark', run);

populatePresetSelect(el('gcode-select'));
applyMode();
renderHistory();

Promise.all([loadVersions(), loadCommitBuilds()]).then(([versions, builds]) => {
  commitBuilds = builds;
  for (const build of builds) buildsByValue.set(commitValue(build), build);

  populateVersionSelect(el('version-a'), versions, latestStable(versions) ?? versions[0], builds);
  populateVersionSelect(el('version-b'), versions, LOCAL_VERSION, builds);

  const sweepOption = el('mode').querySelector('option[value="sweep"]');
  sweepOption.textContent = builds.length ? `Sweep ${builds.length} commit builds` : 'Sweep commit builds (none built)';
  sweepOption.disabled = builds.length === 0;

  if (builds.length) {
    // Harvesting is what the commit builds exist for: default A to the oldest
    // one so a sweep and a one-off harvest start from the same baseline.
    el('version-a').value = commitValue(builds[0]);
  }
});

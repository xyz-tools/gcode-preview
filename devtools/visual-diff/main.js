// Visual diff — renders the same gcode on two gcode-preview versions and
// compares the captured pixels, to catch silent rendering regressions that
// numeric benchmarks miss (colors, gradients, geometry placement).

import { loadVersions, buildImportMap, populateVersionSelect, latestStable, LOCAL_VERSION } from '../lib/versions.js';
import { runInIframe } from '../lib/runner-frame.js';
import { populatePresetSelect, presetSettings, fetchPresetGcode } from '../lib/demo-presets.js';
import { el, setStatus, runWithButton } from '../lib/page.js';

// Captures from the last run, kept so threshold changes recompute the diff
// without re-rendering.
let lastCaptures = null;

async function decodeCapture(capture) {
  const image = new Image();
  image.src = capture.dataURL;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function drawCapture(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

function computeDiff(imageA, imageB, threshold) {
  const { width, height } = imageA;
  const diff = new ImageData(width, height);
  const a = imageA.data;
  const b = imageB.data;
  const out = diff.data;
  let changed = 0;

  for (let i = 0; i < a.length; i += 4) {
    const changedPixel =
      Math.abs(a[i] - b[i]) > threshold ||
      Math.abs(a[i + 1] - b[i + 1]) > threshold ||
      Math.abs(a[i + 2] - b[i + 2]) > threshold;

    if (changedPixel) {
      changed++;
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 255;
    } else {
      // Dimmed grayscale of image A, so the model stays visible for context.
      const gray = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) * 0.4;
      out[i] = gray;
      out[i + 1] = gray;
      out[i + 2] = gray;
    }
    out[i + 3] = 255;
  }

  return { diff, changed, total: width * height };
}

function renderDiff() {
  if (!lastCaptures) return;
  const threshold = parseInt(el('threshold').value, 10) || 0;
  const { imageA, imageB } = lastCaptures;

  const { diff, changed, total } = computeDiff(imageA, imageB, threshold);
  drawCapture(el('canvas-diff'), diff);
  const percent = ((changed / total) * 100).toFixed(2);
  el('diff-stat').textContent =
    `${changed.toLocaleString('en-US')} changed pixels (${percent}%) at threshold ${threshold}`;
}

async function runVisualDiff() {
  const versionA = el('version-a').value;
  const versionB = el('version-b').value;
  const presetKey = el('gcode-select').value;
  const settings = presetSettings(presetKey, { renderTubes: el('render-mode').value === 'tubes' });

  el('frame-label-a').textContent = versionA;
  el('frame-label-b').textContent = versionB;
  el('panel-label-a').textContent = `A: ${versionA}`;
  el('panel-label-b').textContent = `B: ${versionB}`;
  el('diff-stat').textContent = '';
  lastCaptures = null;

  setStatus('Fetching gcode…');
  const gcode = await fetchPresetGcode(presetKey);

  setStatus('Resolving versions…');
  const [importMapA, importMapB] = await Promise.all([buildImportMap(versionA), buildImportMap(versionB)]);

  const runnerUrl = new URL('runner.js', import.meta.url).href;
  const sides = [
    { label: `A (${versionA})`, importMap: importMapA, holder: el('frame-a') },
    { label: `B (${versionB})`, importMap: importMapB, holder: el('frame-b') }
  ];

  const captures = [];
  for (const side of sides) {
    setStatus(`${side.label}: loading…`);
    const capture = await runInIframe({
      holder: side.holder,
      importMap: side.importMap,
      runnerUrl,
      payload: { gcode, settings },
      onPhase: (phase) => setStatus(`${side.label}: ${phase}…`)
    });
    captures.push(capture);
  }

  const [captureA, captureB] = captures;
  if (captureA.width !== captureB.width || captureA.height !== captureB.height) {
    throw new Error(
      `capture sizes differ: A is ${captureA.width}×${captureA.height}, ` +
        `B is ${captureB.width}×${captureB.height} — cannot diff`
    );
  }

  setStatus('Comparing…');
  const [imageA, imageB] = await Promise.all([decodeCapture(captureA), decodeCapture(captureB)]);
  drawCapture(el('canvas-a'), imageA);
  drawCapture(el('canvas-b'), imageB);

  lastCaptures = { imageA, imageB };
  renderDiff();
  setStatus(`Done — captures are ${captureA.width}×${captureA.height}.`);
}

runWithButton(el('run-diff'), 'Visual diff', runVisualDiff);

el('threshold').addEventListener('input', renderDiff);

populatePresetSelect(el('gcode-select'), 'benchy');
loadVersions().then((versions) => {
  populateVersionSelect(el('version-a'), versions, latestStable(versions) ?? versions[0]);
  populateVersionSelect(el('version-b'), versions, LOCAL_VERSION);
});

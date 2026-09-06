// Parser-inspector runner — parses one gcode file inside its iframe and keeps
// the full command list here. Commands can number in the millions on big
// files, so only summaries and small row pages ever cross to the parent.
//
// The runner also hosts the debug session: a live GCodePreview renders into
// this iframe's canvas (the parent makes the iframe visible), and debug
// messages execute command slices into the preview's job via the library's
// own Interpreter (reached through preview.interpreter — not a public export,
// but the dist build keeps property names).
// See ./main.js for the message protocol.

const send = (message) => window.parent.postMessage(message, '*');

// Per-step full rebuilds are instant on small files; above this many commands
// stepping switches to renderProgressive (only not-yet-drawn paths).
const RENDER_FULL_LIMIT = 20_000;
// During continue/run/seek, a progress message goes out every this many
// executed commands.
const PROGRESS_CHUNK = 10_000;

let commands = [];
let filterCache = { filter: null, indices: null };

// debug session
let preview = null;
let metadata = undefined;
let debugIndex = -1;
// kept for rebuilding the preview when the parent applies edited settings
let libModule = null;
let lastGoodSettings = null;

// A rebuilt preview gets a brand-new canvas: reusing one whose WebGL context
// belonged to a disposed renderer invites context-state surprises.
function freshCanvas() {
  const old = document.getElementById('canvas');
  const next = document.createElement('canvas');
  next.id = 'canvas';
  old.replaceWith(next);
  return next;
}

// May throw (bad colors, missing buildVolume, …) — callers decide the
// fallback story.
function instantiate(settings) {
  return new libModule.GCodePreview({ canvas: freshCanvas(), ...settings });
}

// What the scene manager actually ended up with, so the parent can confirm
// applied settings without reading WebGL pixels back.
function settingsEcho() {
  try {
    const sceneManager = preview.sceneManager;
    const hex = (color) => (typeof color?.getHexString === 'function' ? `#${color.getHexString()}` : null);
    return {
      travelColor: hex(sceneManager.travelColor),
      backgroundColor: hex(sceneManager.backgroundColor),
      renderTravel: sceneManager.renderTravel,
      renderTubes: sceneManager.renderTubes,
      orthographic: sceneManager.orthographic
    };
  } catch {
    return null;
  }
}

async function handleLoad({ gcode, settings, fallbackSettings }) {
  const module = await import('gcode-preview');

  // 2.18 exports only WebGLPreview: no Parser export, no processGCodeStream
  // options. Degrade with a note instead of crashing.
  if (!module.GCodePreview || !module.Parser) {
    send({
      type: 'unsupported',
      message:
        'This version exports only WebGLPreview — full inspection needs a 3.x build. Pick "local build" or a 3.x version.'
    });
    return;
  }
  libModule = module;

  // Interpreter-level view: fill preview.job (stats, layers, paths) without
  // rendering anything. The same preview instance later hosts the debug
  // session (after a clear()).
  //
  // `settings` may carry a user override; if the constructor rejects it, fall
  // back to the computed defaults (sent separately) and tell the parent.
  let settingsLoadError = null;
  let activeSettings = settings;
  try {
    preview = instantiate(settings);
  } catch (error) {
    if (!fallbackSettings) throw error;
    settingsLoadError = String(error?.message ?? error);
    activeSettings = fallbackSettings;
    preview = instantiate(fallbackSettings);
  }
  lastGoodSettings = activeSettings;
  await preview.processGCodeStream(gcode, { render: false });

  // Parser-level view: a standalone Parser gives the raw command list without
  // running the interpreter's side effects twice on the preview's job. Its
  // metadata is kept for re-seeding debug jobs (the layer indexer wants it
  // before any command executes).
  const parser = new module.Parser();
  const parsed = parser.parseGCode(gcode);
  commands = parsed.commands;
  metadata = parsed.metadata;
  filterCache = { filter: null, indices: null };

  const counts = new Map();
  for (const command of commands) {
    const key = command.gcode || '(comment/blank)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const histogram = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Debugging needs internals the public API does not promise: the preview's
  // interpreter instance and clear(). The local/3.x builds have both.
  const debuggable = typeof preview.interpreter?.execute === 'function' && typeof preview.clear === 'function';

  // First command with an actual gcode, past the comment/blank preamble
  // slicers emit — the "Run to first" seek target (-1 when there is none).
  const firstCommandIndex = commands.findIndex((command) => Boolean(command.gcode));

  const stats = preview.job.stats;
  send({
    type: 'loaded',
    debuggable,
    firstCommandIndex,
    settingsError: settingsLoadError,
    settingsEcho: settingsEcho(),
    summary: {
      lines: preview.parser.lineCount,
      commands: commands.length,
      layers: preview.countLayers,
      paths: preview.job.paths.length,
      isPlanar: preview.job.isPlanar,
      stats: {
        points: stats.points,
        extrusionDistance: stats.extrusionDistance,
        retractions: stats.retractions,
        deretractions: stats.deretractions,
        feedrateChanges: stats.feedrateChanges,
        others: stats.others
      }
    },
    histogram
  });

  if (debuggable) {
    startSession();
    sendDebug(0);
  }
}

// ---------------------------------------------------------------------------
// Debug session

// Fresh job + state at index -1, empty scene rendered. preview.clear()
// disposes the old scene's geometry and materials, so repeated seeks do not
// leak GPU resources.
function startSession() {
  preview.clear();
  // the layer indexer locks its strategy on the first path, so metadata must
  // land before any command executes
  preview.job.metadata = metadata;
  debugIndex = -1;
}

// All primitive fields of the State instance, plus one level of plain-object
// fields (positionShift.x/y/z), picked up generically so this panel stays in
// sync with the class if fields are added. undefined becomes null to survive
// any structured-clone edge cases and read as "unset" in the parent.
function serializeState(state) {
  const out = {};
  const simple = (value) => value === null || ['number', 'string', 'boolean'].includes(typeof value);
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined || simple(value)) {
      out[key] = value ?? null;
    } else if (typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === undefined || simple(subValue)) out[`${key}.${subKey}`] = subValue ?? null;
      }
    }
  }
  return out;
}

function sendDebug(elapsedMs) {
  const command = debugIndex >= 0 ? commands[debugIndex] : null;
  const job = preview.job;
  send({
    type: 'debug',
    index: debugIndex,
    total: commands.length,
    command: command ? { gcode: command.gcode, params: command.params, src: (command.src ?? '').slice(0, 200) } : null,
    state: serializeState(job.state),
    derived: {
      paths: job.paths.length,
      layers: job.countLayers,
      points: job.stats.points,
      extrusionDistance: Math.round(job.stats.extrusionDistance * 100) / 100
    },
    elapsedMs: Math.round(elapsedMs)
  });
}

const lastIndex = () => commands.length - 1;

function handleDebugStep() {
  if (!preview) return;
  const start = performance.now();
  if (debugIndex < lastIndex()) {
    preview.interpreter.execute([commands[debugIndex + 1]], preview.job);
    debugIndex += 1;
    if (commands.length <= RENDER_FULL_LIMIT) {
      preview.sceneManager.render();
    } else {
      preview.sceneManager.renderProgressive();
    }
  }
  sendDebug(performance.now() - start);
}

// Step back and reset both land here: there is no un-execute, so a fresh
// job/state re-executes commands[0..index] in one interpreter call, then one
// full render.
function handleDebugSeek({ index }) {
  if (!preview) return;
  const target = Math.max(-1, Math.min(index, lastIndex()));
  const start = performance.now();
  startSession();
  if (target >= 0) {
    preview.interpreter.execute(commands.slice(0, target + 1), preview.job);
    debugIndex = target;
    preview.sceneManager.render();
  }
  sendDebug(performance.now() - start);
}

// Executes up to the next breakpoint (or the end). The stop index is computed
// up front and the slice runs in chunks — calling execute() per command would
// pay resumeLastPath's index scans 163k times — so breakpoints are exact and
// big files stay fast. Rendering happens only at the stop point; progress
// messages go out between chunks.
async function handleDebugContinue({ breakpoints = [], toEnd = false }) {
  if (!preview) return;
  const start = performance.now();
  if (debugIndex < lastIndex()) {
    const stops = toEnd ? null : new Set(breakpoints);
    let target = lastIndex();
    if (stops && stops.size > 0) {
      for (let i = debugIndex + 1; i <= lastIndex(); i++) {
        if (stops.has(i)) {
          target = i;
          break;
        }
      }
    }

    let next = debugIndex + 1;
    while (next <= target) {
      const chunkEnd = Math.min(next + PROGRESS_CHUNK, target + 1);
      preview.interpreter.execute(commands.slice(next, chunkEnd), preview.job);
      next = chunkEnd;
      debugIndex = next - 1;
      if (next <= target) {
        send({ type: 'progress', index: debugIndex, target });
        // yield so the progress message actually leaves this task
        await new Promise((resolve) => setTimeout(resolve));
      }
    }
    preview.sceneManager.render();
  }
  sendDebug(performance.now() - start);
}

// Rebuilds the preview with parent-edited settings, preserving the session:
// same command list, same index (re-executed onto the fresh job), and the
// parent keeps its breakpoints. A constructor throw falls back to the last
// settings that worked, so the page never ends up with a dead preview.
function handleApplySettings({ settings }) {
  if (!preview || !libModule) return;
  const start = performance.now();
  const target = debugIndex;

  let ok = true;
  let message = null;
  try {
    preview.dispose();
  } catch {
    // an already-broken preview must not block the rebuild
  }
  try {
    preview = instantiate(settings);
    lastGoodSettings = settings;
  } catch (error) {
    ok = false;
    message = String(error?.message ?? error);
    preview = instantiate(lastGoodSettings);
  }

  startSession();
  if (target >= 0) {
    preview.interpreter.execute(commands.slice(0, target + 1), preview.job);
    debugIndex = target;
    preview.sceneManager.render();
  }
  send({ type: 'settings-applied', ok, message, echo: settingsEcho() });
  sendDebug(performance.now() - start);
}

// ---------------------------------------------------------------------------
// Command browser

// Indices of the commands matching `filter`, cached so paging through a
// filtered view doesn't rescan the whole list on every page turn.
function filteredIndices(filter) {
  if (!filter) return null;
  if (filterCache.filter === filter) return filterCache.indices;
  const needle = filter.toLowerCase();
  const indices = [];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (
      command.gcode === needle ||
      command.src?.toLowerCase().includes(needle) ||
      command.comment?.toLowerCase().includes(needle)
    ) {
      indices.push(i);
    }
  }
  filterCache = { filter, indices };
  return indices;
}

function handleQuery({ offset, limit, filter }) {
  const indices = filteredIndices(filter);
  const total = indices ? indices.length : commands.length;
  const rows = [];
  const end = Math.min(offset + limit, total);
  for (let n = offset; n < end; n++) {
    const index = indices ? indices[n] : n;
    const command = commands[index];
    rows.push({
      index,
      gcode: command.gcode,
      params: command.params,
      comment: command.comment ?? '',
      src: (command.src ?? '').slice(0, 200)
    });
  }
  send({ type: 'page', rows, total, offset, filter });
}

// The parent shows/hides and resizes the iframe; the renderer sized itself
// while the frame was 0×0, so a nudge from the parent (or the window) fixes
// the canvas and camera aspect.
function handleResize() {
  preview?.sceneManager.resize();
}

window.addEventListener('resize', handleResize);

const handlers = {
  load: handleLoad,
  query: handleQuery,
  resize: handleResize,
  'apply-settings': handleApplySettings,
  'debug-step': handleDebugStep,
  'debug-seek': handleDebugSeek,
  'debug-continue': handleDebugContinue
};

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  // own-property guard: a type like '__proto__' must not dispatch into
  // Object.prototype (CodeQL: unvalidated dynamic method call)
  if (!Object.hasOwn(handlers, message.type)) return;
  const handler = handlers[message.type];
  Promise.resolve(handler(message)).catch((error) => {
    console.error(error);
    send({ type: 'error', message: String(error?.message ?? error) });
  });
});

send({ type: 'ready' });

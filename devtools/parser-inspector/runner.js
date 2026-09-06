// Parser-inspector runner — parses one gcode file inside its iframe and keeps
// the full command list here. Commands can number in the millions on big
// files, so only summaries and small row pages ever cross to the parent.
// See ./main.js for the message protocol.

const send = (message) => window.parent.postMessage(message, '*');

let commands = [];
let filterCache = { filter: null, indices: null };

async function handleLoad({ gcode, settings }) {
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

  // Interpreter-level view: fill preview.job (stats, layers, paths) without
  // rendering anything.
  const preview = new module.GCodePreview({
    canvas: document.getElementById('canvas'),
    ...settings
  });
  await preview.processGCodeStream(gcode, { render: false });

  // Parser-level view: a standalone Parser gives the raw command list without
  // running the interpreter's side effects twice on the preview's job.
  const parser = new module.Parser();
  commands = parser.parseGCode(gcode).commands;
  filterCache = { filter: null, indices: null };

  const counts = new Map();
  for (const command of commands) {
    const key = command.gcode || '(comment/blank)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const histogram = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const stats = preview.job.stats;
  send({
    type: 'loaded',
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
}

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

const handlers = { load: handleLoad, query: handleQuery };

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  const handler = handlers[message.type];
  if (!handler) return;
  Promise.resolve(handler(message)).catch((error) => {
    console.error(error);
    send({ type: 'error', message: String(error?.message ?? error) });
  });
});

send({ type: 'ready' });

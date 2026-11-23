// Streaming equivalence runner — parses the same gcode twice inside one
// iframe (whole string, then chunked stream) and reports stats for both.
// See ../lib/runner-frame.js for the message protocol.

import { loadPreview, parseInto, send, onRun } from '../lib/preview-compat.js';

// The iframe srcdoc ships one unused <canvas id="canvas">; the first pass
// claims it, later passes get their own stacked canvas. Never reuse a canvas
// across previews — each pass gets a fresh WebGL context.
function freshCanvas() {
  const original = document.getElementById('canvas');
  if (original && !original.dataset.claimed) {
    original.dataset.claimed = 'true';
    return original;
  }
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  document.body.appendChild(canvas);
  return canvas;
}

// A plain ReadableStream of chunkSize-character chunks. 3.x consumes string
// chunks (what it gets from TextDecoderStream in the demo); 2.x's
// _readFromStream runs TextDecoder.decode() on every chunk itself, so it
// needs bytes (like file.stream() gives it). Small chunks maximize the odds
// of a chunk boundary splitting a line or command mid-way.
function stringToStream(text, chunkSize, { asBytes = false } = {}) {
  const encoder = asBytes ? new TextEncoder() : null;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= text.length) {
        controller.close();
        return;
      }
      const chunk = text.slice(offset, offset + chunkSize);
      controller.enqueue(encoder ? encoder.encode(chunk) : chunk);
      offset += chunkSize;
    }
  });
}

// Flat object of named metrics; only metrics the running version exposes are
// included (3.x has job stats, 2.x mostly just layers), so everything is
// optional-chained.
function collectStats(preview, scene) {
  const stats = {};
  const add = (key, value) => {
    if (value !== undefined && value !== null) stats[key] = value;
  };

  add('lineCount', preview.parser?.lineCount);
  add('layers', preview.countLayers ?? preview.layers?.length);
  add('paths', preview.job?.paths?.length);
  add('isPlanar', preview.job?.isPlanar);

  const jobStats = preview.job?.stats;
  if (jobStats) {
    for (const key of ['points', 'extrusionDistance', 'retractions', 'deretractions', 'feedrateChanges', 'others']) {
      add(key, jobStats[key]);
    }
  }

  // Geometric fingerprint: scene.render() is a synchronous full build+draw,
  // so the triangle count reflects exactly what got parsed.
  scene.render();
  add('triangles', scene.renderer?.info?.render?.triangles);

  return stats;
}

async function runPass({ gcode, settings, mode, chunkSize }) {
  const { preview, scene } = await loadPreview({ canvas: freshCanvas(), ...settings });

  try {
    if (mode === 'whole') {
      // Whole-string pass: the same cross-major fork every tool uses.
      await parseInto(preview, gcode);
    } else if (typeof preview.processGCodeStream === 'function') {
      // 3.x streamed pass: same entry point, fed a chunked stream instead.
      await preview.processGCodeStream(stringToStream(gcode, chunkSize), { render: false });
    } else if (typeof preview._readFromStream === 'function') {
      // 2.x streaming path (@experimental, parse-only, wants byte chunks).
      await preview._readFromStream(stringToStream(gcode, chunkSize, { asBytes: true }));
    } else {
      return { supported: false };
    }

    return { supported: true, stats: collectStats(preview, scene) };
  } finally {
    preview.dispose?.();
  }
}

onRun(async ({ gcode, settings, chunkSize }) => {
  send({ type: 'phase', phase: 'parsing (whole string)' });
  const whole = await runPass({ gcode, settings, mode: 'whole' });

  send({ type: 'phase', phase: 'parsing (streamed)' });
  const streamed = await runPass({ gcode, settings, mode: 'streamed', chunkSize });

  send({
    type: 'result',
    result: {
      whole: whole.stats,
      streamed: streamed.stats ?? null,
      streamingSupported: streamed.supported
    }
  });
});

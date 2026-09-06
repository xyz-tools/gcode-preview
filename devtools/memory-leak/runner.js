// Memory-leak runner — repeatedly creates, loads, renders, and disposes a
// preview inside its iframe, sampling heap and renderer counters per cycle.
// See ../lib/runner-frame.js for the message protocol.

import { loadPreview, send, onRun } from '../lib/preview-compat.js';

const SETTLE_MS = 150;

const heapMB = () => {
  const bytes = performance.memory?.usedJSHeapSize;
  return bytes === undefined ? undefined : bytes / (1024 * 1024);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

onRun(async ({ gcode, settings, cycles }) => {
  // The srcdoc's built-in canvas is unused; each cycle appends a fresh one to
  // mimic a framework unmounting and remounting the component.
  document.getElementById('canvas').style.display = 'none';

  const baselineHeapMB = heapMB();
  const samples = [];

  for (let cycle = 1; cycle <= cycles; cycle++) {
    send({ type: 'phase', phase: `cycle ${cycle}/${cycles}` });

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
    document.body.appendChild(canvas);

    const { preview, scene } = await loadPreview({ canvas, ...settings });

    if (typeof preview.processGCodeStream === 'function') {
      // 3.x — explicit { render: false }: processGCode would play an animation.
      await preview.processGCodeStream(gcode, { render: false });
    } else {
      // 2.x — synchronous parse.
      preview.parser.parseGCode(gcode);
    }

    scene.render();

    // Read renderer counters while the preview is alive. `scene` was grabbed at
    // construction; never touch preview.sceneManager after dispose() — on 3.x
    // that lazy getter would silently re-create the SceneManager.
    const info = scene.renderer?.info;
    const geometries = info?.memory?.geometries;
    const textures = info?.memory?.textures;
    const triangles = info?.render?.triangles;

    preview.dispose();
    canvas.remove();

    // Let GC, GPU teardown, and pending rAF callbacks settle before sampling.
    await wait(SETTLE_MS);

    const sample = { cycle, heapMB: heapMB(), geometries, textures, triangles };
    samples.push(sample);
    send({ type: 'progress', ...sample, baselineHeapMB });
  }

  send({ type: 'result', result: { baselineHeapMB, samples } });
});

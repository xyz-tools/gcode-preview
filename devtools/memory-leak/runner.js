// Memory-leak runner — repeatedly creates, loads, renders, and disposes a
// preview inside its iframe, sampling heap and renderer counters per cycle.
// See ../lib/runner-frame.js for the message protocol.

import { loadPreview, parseInto, send, onRun } from '../lib/preview-compat.js';

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

    await parseInto(preview, gcode);

    scene.render();

    // Grab the renderer and the per-render triangle count while the preview is
    // alive. `scene` was grabbed at construction; never touch
    // preview.sceneManager after dispose() — on 3.x that lazy getter would
    // silently re-create the SceneManager.
    const renderer = scene.renderer;
    const triangles = renderer?.info?.render?.triangles;

    preview.dispose();
    canvas.remove();

    // Let GC, GPU teardown, and pending rAF callbacks settle before sampling.
    await wait(SETTLE_MS);

    // Residual counters AFTER dispose, read from the renderer this cycle
    // created: three.js decrements info.memory as geometries/textures are
    // disposed, so a correct dispose() drives both to ~0 and any residual is
    // a direct "dispose() leaked GPU resources" signal — unlike a pre-dispose
    // read, which is constant by construction on a per-cycle renderer.
    const geometries = renderer?.info?.memory?.geometries;
    const textures = renderer?.info?.memory?.textures;

    const sample = { cycle, heapMB: heapMB(), geometries, textures, triangles };
    samples.push(sample);
    send({ type: 'progress', ...sample, baselineHeapMB });
  }

  send({ type: 'result', result: { baselineHeapMB, samples } });
});

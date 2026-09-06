// Runs inside a sandboxed iframe with an import map pointing at one specific
// gcode-preview version. Loads the library, measures, and posts results back.
//
// Works against both major APIs:
//   3.x: exports GCodePreview, scene bits live on preview.sceneManager
//   2.x: exports WebGLPreview, scene bits live flat on the preview itself

const ORBIT_MS = 5000;
const HEAP_SAMPLE_MS = 50;

const send = (message) => window.parent.postMessage(message, '*');
const bytesToMB = (bytes) => bytes / (1024 * 1024);

function startHeapSampler() {
  const heap = () => performance.memory?.usedJSHeapSize;
  const baseline = heap();
  let peak = baseline;
  const interval = setInterval(() => {
    const current = heap();
    if (current > peak) peak = current;
  }, HEAP_SAMPLE_MS);
  return {
    stop() {
      clearInterval(interval);
      const current = heap();
      if (current > peak) peak = current;
      return baseline === undefined ? undefined : bytesToMB(peak - baseline);
    }
  };
}

function measureFpsWhileOrbiting(camera, target) {
  return new Promise((resolve) => {
    const dx = camera.position.x - target.x;
    const dz = camera.position.z - target.z;
    const radius = Math.sqrt(dx * dx + dz * dz);
    const startAngle = Math.atan2(dz, dx);
    const start = performance.now();
    let frames = 0;

    const tick = () => {
      const elapsed = performance.now() - start;
      frames++;
      // Quarter turn per second; the library's own rAF loop does the rendering.
      const angle = startAngle + (elapsed / 1000) * (Math.PI / 2);
      camera.position.x = target.x + radius * Math.cos(angle);
      camera.position.z = target.z + radius * Math.sin(angle);
      if (elapsed < ORBIT_MS) {
        requestAnimationFrame(tick);
      } else {
        resolve((frames * 1000) / elapsed);
      }
    };
    requestAnimationFrame(tick);
  });
}

async function run({ gcode, renderTubes }) {
  const module = await import('gcode-preview');
  const Preview = module.GCodePreview ?? module.WebGLPreview;
  if (!Preview) throw new Error('no GCodePreview/WebGLPreview export found');

  const heapSampler = startHeapSampler();

  const preview = new Preview({
    canvas: document.getElementById('canvas'),
    buildVolume: { x: 180, y: 180, z: 180 },
    renderTubes,
    backgroundColor: '#141414',
    initialCameraPosition: [-200, 232, 200],
    lineHeight: 0.2,
    extrusionWidth: 0.4
  });
  // 3.x nests the scene under sceneManager; 2.x keeps everything flat.
  const scene = preview.sceneManager ?? preview;

  send({ type: 'phase', phase: 'parsing' });
  const parseStart = performance.now();
  if (typeof preview.processGCodeStream === 'function') {
    await preview.processGCodeStream(gcode, { render: false });
  } else {
    preview.parser.parseGCode(gcode);
  }
  const parseMs = performance.now() - parseStart;

  send({ type: 'phase', phase: 'rendering' });
  const renderStart = performance.now();
  scene.render();
  const renderMs = performance.now() - renderStart;

  const info = scene.renderer?.info;
  const triangles = info?.render?.triangles;
  const drawCalls = info?.render?.calls;

  send({ type: 'phase', phase: 'orbiting' });
  const fps = await measureFpsWhileOrbiting(scene.camera, scene.controls.target);

  const peakHeapMB = heapSampler.stop();

  send({
    type: 'result',
    metrics: {
      parseMs,
      renderMs,
      firstRenderMs: parseMs + renderMs,
      fps,
      peakHeapMB,
      triangles,
      drawCalls
    }
  });
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'run') return;
  run(event.data).catch((error) => {
    console.error(error);
    send({ type: 'error', message: String(error?.message ?? error) });
  });
});

send({ type: 'ready' });

// Visual-diff runner — renders one gcode-preview version inside its iframe
// and captures the WebGL canvas as a PNG. See ../lib/runner-frame.js for the
// message protocol.

import { loadPreview, parseInto, send, onRun } from '../lib/preview-compat.js';

onRun(async ({ gcode, settings }) => {
  const canvas = document.getElementById('canvas');

  // Pin the canvas CSS size to the iframe's viewport (the parent page gives
  // both frame holders the same fixed pixel size) so the library sizes both
  // WebGL buffers identically from the client size.
  canvas.style.width = `${document.documentElement.clientWidth}px`;
  canvas.style.height = `${document.documentElement.clientHeight}px`;

  const { preview, scene } = await loadPreview({ canvas, ...settings });

  send({ type: 'phase', phase: 'parsing' });
  await parseInto(preview, gcode);

  send({ type: 'phase', phase: 'rendering' });
  // Both majors run an internal rAF loop whose controls.update() forces
  // camera.lookAt(controls.target), and their default targets differ. Pin the
  // target and camera so both sides draw the exact same view, then render and
  // capture in one synchronous sequence — 3.x uses preserveDrawingBuffer:
  // false, so the pixels are only readable in the same task as the draw.
  scene.controls.target.set(0, 0, 0);
  scene.camera.position.set(...settings.initialCameraPosition);
  scene.controls.update();
  scene.render();
  send({ type: 'phase', phase: 'capturing' });
  const dataURL = canvas.toDataURL('image/png');

  // Capture is done — stop the library's perpetual rAF render loop so this
  // side can't keep rendering while the other side runs. The captured frame
  // stays visible on the canvas; nothing clears it.
  preview.dispose();

  send({ type: 'result', result: { dataURL, width: canvas.width, height: canvas.height } });
});

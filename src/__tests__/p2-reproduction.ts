/**
 * P2 reproduction: single-layer
 *
 * Load four layers and enable single-layer mode at layer 3.
 * Expected: clipping admits only the third layer center.
 * Actual: the second layer remains visible too.
 * Changing endLayer while in single-layer mode reproduces the same problem.
 * An explicit inclusive startLayer=3/endLayer=3 range is a passing control.
 *
 * Run: NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p2-reproduction.ts
 * The Node 26 flag avoids the happy-dom storage conflict. Regression failures
 * are intentional until the implementation is fixed.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GCodePreview } from '../gcode-preview';

// Keep parsing, interpretation, scene management and geometry real; only replace
// the GPU renderer so this reproduction runs without a browser.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement: HTMLCanvasElement;
      localClippingEnabled = false;
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = vi.fn();
      dispose = vi.fn();
      constructor(opts: { canvas: HTMLCanvasElement }) {
        this.domElement = opts.canvas;
      }
    }
  };
});

let preview: GCodePreview | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  preview?.dispose();
  preview = undefined;
  vi.restoreAllMocks();
});

function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  Object.defineProperties(element, {
    offsetWidth: { value: 640 },
    offsetHeight: { value: 480 }
  });
  return element;
}

import { Vector3 } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

test.each(['explicit range', 'enable mode', 'change end layer'])('%s shows only layer 3', async (mode) => {
  preview = new GCodePreview({ canvas: canvas(), buildVolume: { x: 200, y: 200, z: 200 } });
  await preview.processGCodeStream(
    'G0 X0 Y0 Z0.2\nG1 X10 E1\nG0 Z0.4\nG1 X20 E1\nG0 Z0.6\nG1 X30 E1\nG0 Z0.8\nG1 X40 E1',
    { render: false }
  );
  const manager = preview.sceneManager;
  manager.render();
  manager.endLayer = mode === 'change end layer' ? 2 : 3;
  if (mode === 'explicit range') manager.startLayer = 3;
  else manager.singleLayerMode = true;
  if (mode === 'change end layer') manager.endLayer = 3;

  const lines: LineSegments2[] = [];
  manager.scene.traverse((object) => {
    if (object instanceof LineSegments2) lines.push(object);
  });
  expect(lines.length).toBeGreaterThan(0);
  // Lines are centered half a line-height below nozzle Z; G-code Z maps to world Y.
  for (const line of lines) {
    const planes = line.material.clippingPlanes ?? [];
    const visible = [0.1, 0.3, 0.5, 0.7].map((y) =>
      planes.every((plane) => plane.distanceToPoint(new Vector3(15, y, 0)) >= 0)
    );
    expect(visible).toEqual([false, false, true, false]);
  }
});

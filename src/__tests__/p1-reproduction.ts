/**
 * P1 reproduction: quick-start
 *
 * Construct the README preview with a canvas and extrusionColor only.
 * Expected: construction succeeds and the diagonal extrusion is rendered.
 * Actual: SceneManager reads buildVolume.x although buildVolume is optional,
 * throwing before the example can process G-code.
 *
 * Run: NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p1-reproduction.ts
 * The Node 26 flag avoids the happy-dom storage conflict. Failures are intentional
 * until the implementation is fixed.
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

test('README quick start constructs without an optional build volume', async () => {
  preview = new GCodePreview({ canvas: canvas(), extrusionColor: 'hotpink' });
  await preview.processGCode('G0 X0 Y0 Z0.2\nG1 X42 Y42 E10');
  expect(preview.job.extrusions).toHaveLength(1);
  expect(preview.job.state).toMatchObject({ x: 42, y: 42, z: 0.2 });
});

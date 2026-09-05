/**
 * P2 reproduction: animated-dispose
 *
 * Start renderAnimated(1) on a multi-path job, then dispose before the next frame.
 * Expected: no renderer calls after disposal.
 * Actual: the incremental frame callback survives and continues drawing.
 * Animation frames are queued manually so the reproduction is deterministic;
 * only the GPU renderer is mocked.
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

test('disposing cancels pending incremental render frames', async () => {
  let nextId = 0;
  const frames = new Map<number, (_timestamp: number) => void>();
  vi.stubGlobal('requestAnimationFrame', (callback: (_timestamp: number) => void) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  try {
    preview = new GCodePreview({ canvas: canvas(), buildVolume: { x: 200, y: 200, z: 200 } });
    await preview.processGCodeStream('G0 X0 Y0 Z0.2\nG1 X10 E1\nG0 Z0.4\nG1 X20 E1', { render: false });
    const manager = preview.sceneManager;
    const rendering = manager.renderAnimated(1);
    // A future cancellation policy may reject; avoid an unhandled rejection.
    void rendering.catch(() => undefined);
    expect(frames.size).toBeGreaterThan(0);
    preview.dispose();
    const draw = vi.mocked(manager.renderer.render);
    const callsAtDisposal = draw.mock.calls.length;

    // Deliver the frames still queued after disposal, as the browser would.
    const pending = [...frames.entries()];
    for (const [id, callback] of pending) {
      frames.delete(id);
      callback(16);
    }
    expect(draw.mock.calls.length).toBe(callsAtDisposal);
  } finally {
    frames.clear();
    vi.unstubAllGlobals();
  }
});

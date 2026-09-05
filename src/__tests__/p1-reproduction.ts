/**
 * P1 reproduction: stream-clear
 *
 * Pause an old stream after X10, clear the preview, and load a job ending X100.
 * Then deliver an old-stream G1 X999 E1 chunk.
 * Expected: the replacement keeps its X100 state, source lines and geometry.
 * Actual: the old chunk appends to the replacement and changes its state to X999.
 * Chunk delivery is explicitly gated; the reproduction needs no timing sleeps.
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

test('clearing an in-flight stream prevents old chunks from entering the replacement job', async () => {
  preview = new GCodePreview({
    canvas: canvas(),
    buildVolume: { x: 200, y: 200, z: 200 },
    keepLines: true
  });
  let controller!: ReadableStreamDefaultController<string>;
  let cancelled = false;
  const stream = new ReadableStream<string>({
    start(value) {
      controller = value;
      controller.enqueue('G0 X0 Y0 Z0.2\nG1 X10 E1\n');
    },
    cancel() {
      cancelled = true;
    }
  });
  let firstChunkRead!: () => void;
  const firstChunk = new Promise<void>((resolve) => {
    firstChunkRead = resolve;
  });
  preview.onJobUpdated = () => firstChunkRead();
  // Attach rejection handling immediately: cancellation may reject with AbortError.
  const loading = preview.processGCodeStream(stream, { render: false }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
  });
  await firstChunk;
  expect(preview.job.state.x).toBe(10);

  preview.clear();
  await preview.processGCodeStream('G0 X0 Y0 Z0.2\nG1 X100 E1', { render: false });
  const replacement = preview.job;
  const expectedLines = [...preview.parser.lines];
  const expectedPaths = replacement.paths.map((path) => [...path.vertices]);

  // Simulate a delayed network chunk; a fix may have cancelled the reader already.
  if (!cancelled) {
    controller.enqueue('G1 X999 E1\n');
    controller.close();
  }
  await loading;

  expect(preview.job).toBe(replacement);
  expect.soft(preview.job.state.x).toBe(100);
  expect.soft(preview.parser.lines).toEqual(expectedLines);
  expect(preview.job.paths.map((path) => path.vertices)).toEqual(expectedPaths);
});

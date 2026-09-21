/* eslint-disable @typescript-eslint/no-empty-function */

import { test, expect, vi, assert } from 'vitest';

import { SceneManager } from '../scene-manager';
import { GCodeCommand } from '../parser/gcode-parser';

// add a test for destroying the scene manager which should cancel the render loop.
test('destroying the scene manager should dispose renderer and controls', async () => {
  const mock = createMockSceneManager();
  // dispose() empties the array, so keep a reference to assert against afterwards
  const disposables = [...mock.disposables];

  SceneManager.prototype.animate.call(mock);
  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));

  // destroy the scene manager
  SceneManager.prototype.dispose.call(mock);

  // the constructor registers both as disposables rather than disposing them directly
  expect(mock.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(mock.controls.dispose).toHaveBeenCalledTimes(1);

  expect(mock.disposables.length).toBe(0);
  // all disposables should be disposed
  disposables.forEach((d) => {
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });
});

// add a test for destroying the scene manager which should cancel the render loop.
test('destroying the scene manager should call cancelAnimation', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.animate.call(mock);

  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));
  let callCount = mock.renderer.render.mock.calls.length;
  assert(callCount > 2, 'callCount > 2');
  callCount = mock.controls.update.mock.calls.length;
  assert(callCount > 2, 'callCount > 2');

  // destroy the renderer
  SceneManager.prototype.dispose.call(mock);
  expect(mock.cancelAnimation).toHaveBeenCalledTimes(1);
});

test('cancelAnimation should cancel the render loop', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.animate.call(mock);

  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));

  mock.cancelAnimation();

  await new Promise((resolve) => setTimeout(resolve, 50));

  const callCountAfterDestroy = mock.renderer.render.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const callCountAfterDestroy2 = mock.renderer.render.mock.calls.length;

  // expect no more calls to render
  expect(callCountAfterDestroy).toBe(callCountAfterDestroy2);
});

test('disposing cancels pending incremental render frames', () => {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  try {
    const proto = SceneManager.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const mock = createMockSceneManager() as ReturnType<typeof createMockSceneManager> & {
      job?: { paths: number[] };
      renderPaths: ReturnType<typeof vi.fn>;
      renderBoundingBox: ReturnType<typeof vi.fn>;
      renderFrameLoop: unknown;
      renderFrame: unknown;
    };
    mock.job = { paths: [1, 2, 3, 4] };
    mock.renderPaths = vi.fn();
    mock.renderBoundingBox = vi.fn();
    // the loop under test is private, so borrow it from the prototype like cancelAnimation above
    mock.renderFrameLoop = proto.renderFrameLoop;
    mock.renderFrame = proto.renderFrame;

    // the promise never settles once disposal cancels the loop, so don't await it
    void SceneManager.prototype.renderAnimated.call(mock, 1);
    expect(frames.size).toBeGreaterThan(0);

    SceneManager.prototype.dispose.call(mock);
    const callsAtDisposal = mock.renderer.render.mock.calls.length;

    // deliver the frames still queued after disposal, as the browser would
    for (const [id, callback] of [...frames.entries()]) {
      frames.delete(id);
      callback(16);
    }
    expect(mock.renderer.render.mock.calls.length).toBe(callsAtDisposal);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('renderProgressive draws the paths parsed so far, holding back the still-growing last one', () => {
  const mock = createMockSceneManager() as ReturnType<typeof createMockSceneManager> & {
    job?: { paths: number[] };
    renderPaths: ReturnType<typeof vi.fn>;
  };
  mock.job = { paths: [1, 2, 3] };
  mock.renderPaths = vi.fn();

  SceneManager.prototype.renderProgressive.call(mock);

  expect(mock.renderPaths).toHaveBeenCalledWith(2);
});

test('renderProgressive never passes a negative path count', () => {
  const mock = createMockSceneManager() as ReturnType<typeof createMockSceneManager> & {
    job?: { paths: number[] };
    renderPaths: ReturnType<typeof vi.fn>;
  };
  mock.job = { paths: [] };
  mock.renderPaths = vi.fn();

  SceneManager.prototype.renderProgressive.call(mock);

  expect(mock.renderPaths).toHaveBeenCalledWith(0);
});

test('renderProgressive does nothing without a job', () => {
  const mock = createMockSceneManager() as ReturnType<typeof createMockSceneManager> & {
    job?: { paths: number[] };
    renderPaths: ReturnType<typeof vi.fn>;
  };
  mock.job = undefined;
  mock.renderPaths = vi.fn();

  SceneManager.prototype.renderProgressive.call(mock);

  expect(mock.renderPaths).not.toHaveBeenCalled();
});

function createMockSceneManager() {
  const renderer = {
    render: vi.fn(() => {}),
    dispose: vi.fn(() => {})
  };
  const controls = {
    update: vi.fn(() => {}),
    dispose: vi.fn(() => {})
  };

  return {
    // state: State.initial,
    minLayerIndex: 0,
    maxLayerIndex: Infinity,
    // mirrors the constructor, which pushes the renderer and controls onto disposables
    disposables: [
      {
        dispose: vi.fn(() => {
          // console.log('dispose');
        })
      },
      renderer,
      controls
    ],
    layers: [
      {
        commands: [] as GCodeCommand[]
      }
    ],
    scene: {},
    camera: {},
    renderer,
    controls,
    setInches: () => {},
    renderExtrusion: () => {},
    renderTravel: () => {},
    addArcSegment: () => {},
    addLineSegment: () => {},
    doRenderExtrusion: () => {},
    render: vi.fn(() => {}),
    animate: vi.fn(SceneManager.prototype.animate),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    cancelAnimation: vi.fn(SceneManager.prototype.cancelAnimation)
  };
}

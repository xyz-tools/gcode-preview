/* eslint-disable @typescript-eslint/no-empty-function */

import { test, expect, vi } from 'vitest';

import { SceneManager } from '../scene-manager';
import { GCodeCommand } from '../parser/gcode-parser';

test('destroying the scene manager should dispose renderer and controls', () => {
  const mock = createMockSceneManager();
  // dispose() empties the array, so keep a reference to assert against afterwards
  const disposables = [...mock.disposables];

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
  // no frame was pending, so there was nothing to cancel — but the id is cleared
  expect(mock.cancelAnimation).toHaveBeenCalledTimes(1);
});

test('requestRender draws exactly one frame, then goes idle', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.requestRender.call(mock);

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.renderer.render).toHaveBeenCalledTimes(1);

  // no self-rearming loop: with nothing else requested, no further frames draw
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.renderer.render).toHaveBeenCalledTimes(1);
});

test('a burst of requestRender calls coalesces into a single frame', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.requestRender.call(mock);
  SceneManager.prototype.requestRender.call(mock);
  SceneManager.prototype.requestRender.call(mock);

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.renderer.render).toHaveBeenCalledTimes(1);

  // the pending flag was cleared, so a new request draws a new frame
  SceneManager.prototype.requestRender.call(mock);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.renderer.render).toHaveBeenCalledTimes(2);
});

test('destroying the scene manager should cancel a pending frame', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.requestRender.call(mock);

  // destroy the scene manager before the frame fires
  SceneManager.prototype.dispose.call(mock);
  expect(mock.cancelAnimation).toHaveBeenCalledTimes(1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.renderer.render).not.toHaveBeenCalled();
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
    requestRender: vi.fn(SceneManager.prototype.requestRender),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    cancelAnimation: vi.fn(SceneManager.prototype.cancelAnimation)
  };
}

/* eslint-disable @typescript-eslint/no-empty-function */

import { test, expect, vi, assert } from 'vitest';

import { Renderer } from '../renderer';
import { GCodeCommand } from '../gcode-parser';

// add a test for destroying the renderer which should cancel the render loop.
test('destroying the renderer should dispose renderer and controls', async () => {
  const mock = createMockRenderer();

  Renderer.prototype.animate.call(mock);
  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));

  // destroy the renderer
  Renderer.prototype.dispose.call(mock);

  expect(mock.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(mock.controls.dispose).toHaveBeenCalledTimes(1);

  expect(mock.disposables.length).toBe(0);
  // all disposables should be disposed
  mock.disposables.forEach((d) => {
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });
});

// add a test for destroying the renderer which should cancel the render loop.
test('destroying the renderer should call cancelAnimation', async () => {
  const mock = createMockRenderer();

  Renderer.prototype.animate.call(mock);

  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));
  let callCount = mock.renderer.render.mock.calls.length;
  assert(callCount > 2, 'callCount > 2');
  callCount = mock.controls.update.mock.calls.length;
  assert(callCount > 2, 'callCount > 2');

  // destroy the renderer
  Renderer.prototype.dispose.call(mock);
  expect(mock.cancelAnimation).toHaveBeenCalledTimes(1);
});

test('cancelAnimation should cancel the render loop', async () => {
  const mock = createMockRenderer();

  Renderer.prototype.animate.call(mock);

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

function createMockRenderer() {
  return {
    // state: State.initial,
    minLayerIndex: 0,
    maxLayerIndex: Infinity,
    disposables: [
      {
        dispose: vi.fn(() => {
          // console.log('dispose');
        })
      }
    ],
    layers: [
      {
        commands: [] as GCodeCommand[]
      }
    ],
    scene: {},
    camera: {},
    renderer: {
      render: vi.fn(() => {}),
      dispose: vi.fn(() => {})
    },
    controls: {
      update: vi.fn(() => {}),
      dispose: vi.fn(() => {})
    },
    setInches: () => {},
    nonTravelmoves: [],
    renderExtrusion: () => {},
    renderTravel: () => {},
    addArcSegment: () => {},
    addLineSegment: () => {},
    doRenderExtrusion: () => {},
    render: vi.fn(() => {}),
    animate: vi.fn(Renderer.prototype.animate),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    cancelAnimation: vi.fn(Renderer.prototype.cancelAnimation)
  };
}

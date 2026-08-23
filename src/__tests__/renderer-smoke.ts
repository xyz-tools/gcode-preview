/* eslint-disable @typescript-eslint/no-empty-function */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { BatchedMesh } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

import { GCodePreview } from '../gcode-preview';

const SAMPLE_GCODE = [
  'G28',
  'G1 X0 Y0 Z0.2 F1200',
  'G1 X10 Y0 E1',
  'G1 X10 Y10 E2',
  'G1 X0 Y10 E3',
  'G1 X0 Y0 E4'
].join('\n');

const { MockWebGLRenderer, mockRenderers } = vi.hoisted(() => {
  const mockRenderers: MockWebGLRenderer[] = [];

  class MockWebGLRenderer {
    domElement: HTMLElement;
    info = {
      render: { triangles: 0, calls: 0, lines: 0, points: 0 },
      memory: { geometries: 0, textures: 0 }
    };
    localClippingEnabled = false;
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();

    constructor(opts: { canvas?: HTMLElement } = {}) {
      this.domElement = opts.canvas ?? document.createElement('canvas');
      mockRenderers.push(this);
    }
  }

  return { MockWebGLRenderer, mockRenderers };
});

// Only the WebGLRenderer is replaced so the tests can run without a GPU.
// Every other three.js class stays real, meaning the actual BatchedMesh,
// LineSegments2, LineMaterial and OrbitControls get constructed at runtime.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

async function nextFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function createPreview(opts: Record<string, unknown> = {}) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(canvas, 'offsetHeight', { value: 600, configurable: true });
  return new GCodePreview({ canvas, buildVolume: { x: 200, y: 200, z: 200 }, ...opts });
}

describe('SceneManager runtime smoke test', () => {
  afterEach(() => {
    mockRenderers.forEach((renderer) => {
      renderer.render.mockClear();
      renderer.dispose.mockClear();
    });
    mockRenderers.length = 0;
  });

  it('constructs real three.js objects when rendering lines', async () => {
    const preview = createPreview({ renderExtrusion: true, renderTravel: true });
    preview.processGCode(SAMPLE_GCODE);
    await nextFrame();

    const group = preview.sceneManager.scene.getObjectByName('Extrusions');
    expect(group).toBeDefined();
    expect(group?.children.length).toBeGreaterThan(0);

    let lineCount = 0;
    preview.sceneManager.scene.traverse((obj) => {
      if (obj instanceof LineSegments2) lineCount++;
    });
    expect(lineCount).toBeGreaterThan(0);

    // the render loop ran against the mocked renderer
    expect(mockRenderers[0].render).toHaveBeenCalled();

    expect(() => preview.dispose()).not.toThrow();
    expect(mockRenderers[0].dispose).toHaveBeenCalled();
  });

  it('constructs a real BatchedMesh when rendering tubes', async () => {
    const preview = createPreview({ renderExtrusion: true, renderTravel: false, renderTubes: true });
    preview.processGCode(SAMPLE_GCODE);
    await nextFrame();

    let batchedMeshCount = 0;
    preview.sceneManager.scene.traverse((obj) => {
      if (obj instanceof BatchedMesh) batchedMeshCount++;
    });
    expect(batchedMeshCount).toBeGreaterThan(0);

    expect(() => preview.dispose()).not.toThrow();
    expect(mockRenderers[0].dispose).toHaveBeenCalled();
  });
});

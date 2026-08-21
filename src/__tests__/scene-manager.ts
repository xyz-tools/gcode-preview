/* eslint-disable @typescript-eslint/no-empty-function */

import { test, expect, vi, assert } from 'vitest';

import { SceneManager } from '../scene-manager';
import { GCodeCommand } from '../gcode-parser';
import { Job } from '../job';
import { createColorMaterial } from '../helpers/colorMaterial';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3
} from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Build a mock whose prototype chain is SceneManager.prototype so real getters,
// setters and cross-method calls resolve, while instance fields stay mockable.
function makeSM(props: Record<string, unknown>): any {
  return Object.assign(Object.create(SceneManager.prototype), props);
}

// Access a prototype setter directly (for setters we call with an explicit `this`).
function setterOf(name: string): (v: unknown) => void {
  return Object.getOwnPropertyDescriptor(SceneManager.prototype, name)!.set!;
}

function proto(name: string): (...args: unknown[]) => unknown {
  return (SceneManager.prototype as any)[name];
}

function makeControls() {
  return { target: new Vector3(), dispose: vi.fn(), update: vi.fn() };
}

// add a test for destroying the scene manager which should cancel the render loop.
test('destroying the scene manager should dispose renderer and controls', async () => {
  const mock = createMockSceneManager();

  SceneManager.prototype.animate.call(mock);
  // wait 50ms
  await new Promise((resolve) => setTimeout(resolve, 50));

  // destroy the scene manager
  SceneManager.prototype.dispose.call(mock);

  expect(mock.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(mock.controls.dispose).toHaveBeenCalledTimes(1);

  expect(mock.disposables.length).toBe(0);
  // all disposables should be disposed
  mock.disposables.forEach((d) => {
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

function createMockSceneManager() {
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
    animate: vi.fn(SceneManager.prototype.animate),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    cancelAnimation: vi.fn(SceneManager.prototype.cancelAnimation)
  };
}

// ---------------------------------------------------------------------------
// Branch-coverage tests. The real constructor instantiates a WebGLRenderer
// which cannot run under happy-dom, so we either exercise the constructor up to
// (but not past) the renderer creation via try/catch, or invoke prototype
// methods against mock objects.
// ---------------------------------------------------------------------------

test('constructor exercises option branches before the WebGLRenderer throws', () => {
  const canvas = document.createElement('canvas');

  // All optional keys absent -> false side of every option `if`, canvas present.
  expect(() => new SceneManager({ canvas } as any, new Job())).toThrow();

  // All optional keys present -> true side of every option `if`.
  expect(
    () =>
      new SceneManager(
        {
          canvas,
          backgroundColor: '#123456',
          buildVolume: { x: 100, y: 100, z: 100, smallGrid: true },
          boundingBoxColor: '#ff0000',
          extrusionColor: ['#00ff00', '#0000ff'],
          travelColor: '#0000ff',
          topLayerColor: '#ffffff',
          lastSegmentColor: '#000000',
          toolColors: { 0: '#aaaaaa' },
          disableGradient: true,
          endLayer: 5,
          startLayer: 1
        } as any,
        new Job()
      )
  ).toThrow();

  // Missing canvas -> the `!opts.canvas` true branch (explicit throw).
  expect(() => new SceneManager({} as any, new Job())).toThrow('Set either');
});

test('buildVolume setter: truthy value creates volume, falsy disposes', () => {
  const scene = new Scene();

  const withValue = makeSM({ scene, disposables: [] });
  setterOf('buildVolume').call(withValue, { x: 100, y: 100, z: 100, smallGrid: false });
  expect(withValue.buildVolume).toBeDefined();
  expect(withValue.disposables.length).toBe(1);

  const dispose = vi.fn();
  const withoutValue = makeSM({ scene, disposables: [], _buildVolume: { dispose } });
  setterOf('buildVolume').call(withoutValue, undefined);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(withoutValue.buildVolume).toBeUndefined();
});

test('extrusionColor setter: array and single-color paths', () => {
  // Plain objects (not prototype-backed) so `this.ambientLight` etc. read data
  // fields rather than invoking the getters/setters that touch materials.
  const light = { ambientLight: 0.4, directionalLight: 1.3, brightness: 1.3 };

  // Array, empty materials -> create + assign uniforms.
  const a: any = { ...light, materials: [] };
  setterOf('extrusionColor').call(a, ['#ff0000', '#00ff00']);
  expect(Array.isArray(a._extrusionColor)).toBe(true);

  // Array, material already present with uniforms -> skip create, set uniforms.
  const b: any = { ...light, materials: [{ uniforms: { uColor: { value: 0 } } }] };
  setterOf('extrusionColor').call(b, ['#101010']);
  expect(b.materials[0].uniforms.uColor.value).toBeInstanceOf(Color);

  // Array, material present WITHOUT uniforms -> the `material && material.uniforms` false side.
  const c: any = { ...light, materials: [{}] };
  expect(() => setterOf('extrusionColor').call(c, ['#202020'])).not.toThrow();

  // Single color, empty materials -> create + assign.
  const d: any = { ...light, materials: [] };
  setterOf('extrusionColor').call(d, '#abcdef');
  expect(d._extrusionColor).toBeInstanceOf(Color);

  // Single color, material already present -> skip create branch.
  const e: any = { ...light, materials: [{ uniforms: { uColor: { value: 0 } } }] };
  setterOf('extrusionColor').call(e, '#123123');
  expect(e.materials[0].uniforms.uColor.value).toBeInstanceOf(Color);
});

test('createClippingPlanes: both min/max defined and undefined', () => {
  const both = proto('createClippingPlanes').call({}, 1, 2) as unknown[];
  expect(both.length).toBe(2);
  const neither = proto('createClippingPlanes').call({}, undefined, undefined) as unknown[];
  expect(neither.length).toBe(0);
});

test('updateLineClipping: non-LineSegments2 objects are skipped', () => {
  const mock = {
    scene: { traverse: (cb: (o: unknown) => void) => cb({}) },
    createClippingPlanes: () => []
  };
  expect(() => proto('updateLineClipping').call(mock, 0, 10)).not.toThrow();
});

function layerMock(extra: Record<string, unknown> = {}): any {
  return makeSM({
    job: {
      countLayers: 10,
      layers: [
        { z: 1, height: 0.2 },
        { z: 2, height: 0.2 }
      ]
    },
    materials: [],
    scene: { traverse: () => {} },
    _startLayer: 1,
    _endLayer: 1,
    _singleLayerMode: false,
    prevStartLayer: 0,
    ...extra
  });
}

test('endLayer setter: numeric/undefined and single-layer-mode branches', () => {
  const notSingle = layerMock();
  notSingle.endLayer = 5;
  expect(notSingle.endLayer).toBe(5);

  const undef = layerMock();
  undef.endLayer = undefined;
  expect(undef.endLayer).toBeUndefined();

  const single = layerMock({ _singleLayerMode: true });
  single.endLayer = 5;
  expect(single.endLayer).toBe(5);
});

test('singleLayerMode setter: toggle on, no-op, and off', () => {
  const on = layerMock({ _singleLayerMode: false, _startLayer: 2, _endLayer: 5 });
  on.singleLayerMode = true;
  expect(on.singleLayerMode).toBe(true);

  // Same value -> early return.
  on.singleLayerMode = true;
  expect(on.singleLayerMode).toBe(true);

  const off = layerMock({ _singleLayerMode: true, _startLayer: 4, _endLayer: 5, prevStartLayer: 1 });
  off.singleLayerMode = false;
  expect(off.singleLayerMode).toBe(false);
});

test('orthographic setter: switch modes and early-return', () => {
  const canvas = document.createElement('canvas');
  const renderer = {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setSize: vi.fn()
  };

  // Perspective -> orthographic (value truthy: screenSpacePanning branch).
  const toOrtho = makeSM({
    camera: new PerspectiveCamera(),
    controls: makeControls(),
    renderer,
    canvas,
    job: {},
    _buildVolume: undefined
  });
  toOrtho.orthographic = true;
  expect(toOrtho.orthographic).toBe(true);

  // Orthographic -> perspective (value falsy: skip screenSpacePanning).
  const toPersp = makeSM({
    camera: new OrthographicCamera(-1, 1, 1, -1, 0.1, 100),
    controls: makeControls(),
    renderer,
    canvas,
    job: {},
    _buildVolume: undefined
  });
  toPersp.orthographic = false;
  expect(toPersp.orthographic).toBe(false);

  // No change -> early return.
  const noChange = makeSM({ camera: new PerspectiveCamera(), controls: makeControls() });
  noChange.orthographic = false;
  expect(noChange.orthographic).toBe(false);
});

test('getOrthoFrustumSize: bounding box, build volume, and default', () => {
  const fromBB = proto('getOrthoFrustumSize').call({
    job: { boundingBox: { isValid: true, size: { x: 10, y: 20, z: 5 } } }
  });
  expect(fromBB).toBeGreaterThan(0);

  const fromVolume = proto('getOrthoFrustumSize').call({
    job: { boundingBox: { isValid: false } },
    _buildVolume: { x: 100, y: 200, z: 50 }
  });
  expect(fromVolume).toBeGreaterThan(0);

  const fallback = proto('getOrthoFrustumSize').call({
    job: { boundingBox: { isValid: false } },
    _buildVolume: undefined
  });
  expect(fallback).toBe(500);
});

test('initScene: group/no-group and buildVolume branches', () => {
  const mkNode = (children: any[] = []): any => ({
    children,
    remove(c: any) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
  });

  // group present with a nested child (recurse) and a childless child (skip),
  // no build volume.
  const leaf = mkNode([]);
  const parent = mkNode([leaf]);
  const group = mkNode([parent, mkNode([])]);
  proto('initScene').call({
    materials: [],
    group,
    scene: { remove: vi.fn() },
    _buildVolume: undefined,
    disposables: []
  });
  expect(group.children.length).toBe(0);

  // no group, build volume present.
  const bv = { update: vi.fn() };
  const disposables: unknown[] = [];
  proto('initScene').call({
    materials: [],
    group: undefined,
    scene: { remove: vi.fn() },
    _buildVolume: bv,
    disposables
  });
  expect(bv.update).toHaveBeenCalledTimes(1);
  expect(disposables.length).toBe(1);
});

test('render: with and without a bounding box color', () => {
  const mkRender = (bb: unknown) =>
    makeSM({
      group: {},
      createGroup: vi.fn(() => ({})),
      initScene: vi.fn(),
      renderPaths: vi.fn(),
      renderBoundingBox: vi.fn(),
      scene: { add: vi.fn() },
      renderer: { render: vi.fn() },
      camera: {},
      _boundingBoxColor: bb
    });

  const noBB = mkRender(undefined);
  SceneManager.prototype.render.call(noBB);
  expect(noBB.renderBoundingBox).not.toHaveBeenCalled();

  const withBB = mkRender(new Color('red'));
  SceneManager.prototype.render.call(withBB);
  expect(withBB.renderBoundingBox).toHaveBeenCalledTimes(1);
});

test('renderFrame: group creation and bounding box branches', () => {
  const mkFrame = (group: unknown, bb: unknown) =>
    makeSM({
      group,
      scene: { add: vi.fn() },
      createGroup: vi.fn(() => ({ add: vi.fn() })),
      renderPaths: vi.fn(),
      renderBoundingBox: vi.fn(),
      job: { paths: { length: 100 } },
      renderPathIndex: 0,
      _boundingBoxColor: bb
    });

  // group exists, no bounding box color.
  const existing = mkFrame({ add: vi.fn() }, undefined);
  proto('renderFrame').call(existing, 10);
  expect(existing.renderBoundingBox).not.toHaveBeenCalled();

  // no group, bounding box color present.
  const fresh = mkFrame(undefined, new Color('red'));
  proto('renderFrame').call(fresh, 10);
  expect(fresh.createGroup).toHaveBeenCalledTimes(1);
  expect(fresh.renderBoundingBox).toHaveBeenCalledTimes(1);
});

test('renderBoundingBox: all guard branches', () => {
  // job present, valid, mesh already exists -> reuse mesh.
  const mesh = { visible: false, material: { color: null as unknown } };
  proto('renderBoundingBox').call({
    job: { boundingBox: { isValid: true } },
    boundingBoxMesh: mesh,
    _boundingBoxColor: new Color('red')
  });
  expect(mesh.visible).toBe(true);

  // job present, valid, no mesh -> create one.
  const created: any = { material: { color: null }, visible: false, name: '' };
  const disposables: unknown[] = [];
  proto('renderBoundingBox').call({
    job: { boundingBox: { isValid: true } },
    boundingBoxMesh: undefined,
    createBoundingBox: vi.fn(() => created),
    disposables,
    scene: { add: vi.fn() },
    _boundingBoxColor: new Color('red')
  });
  expect(disposables.length).toBe(1);

  // invalid bounding box -> console.error + early return.
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  proto('renderBoundingBox').call({ job: { boundingBox: { isValid: false } } });
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();

  // no job -> early return.
  expect(() => proto('renderBoundingBox').call({ job: undefined })).not.toThrow();
});

test('cancelAnimation: no-op when no frame is scheduled', () => {
  expect(() => proto('cancelAnimation').call({ animationFrameId: undefined })).not.toThrow();
});

test('renderPaths: neither travel nor extrusion enabled', () => {
  expect(() => proto('renderPaths').call({ renderTravel: false, renderExtrusion: false })).not.toThrow();
});

test('renderPathsAsTubes: skips paths without geometry', () => {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 1, 1, 2, 2, 2], 3));
  const paths = [{ geometry: () => geom }, { geometry: () => undefined }];
  const add = vi.fn();
  // Prototype-backed so `this.createBatchMesh` resolves; light values via the
  // private fields the getters read.
  const mock = makeSM({
    extrusionWidth: 1,
    lineHeight: 0.2,
    _ambientLight: 0.4,
    _directionalLight: 1.3,
    _brightness: 1.3,
    materials: [],
    disposables: [],
    currentChunk: { add }
  });
  proto('renderPathsAsTubes').call(mock, paths as any, new Color('red'));
  expect(add).toHaveBeenCalledTimes(1);
});

test('loadCamera: restores when all values present, no-op otherwise', () => {
  localStorage.clear();
  const empty = { camera: { position: {}, rotation: {} }, controls: { target: {}, update: vi.fn() } };
  SceneManager.prototype.loadCamera.call(empty as any);
  expect(empty.controls.update).not.toHaveBeenCalled();

  localStorage.setItem('cameraPosition', JSON.stringify({ x: 1, y: 2, z: 3 }));
  localStorage.setItem('cameraRotation', JSON.stringify({ x: 0, y: 0, z: 0 }));
  localStorage.setItem('cameraZoom', JSON.stringify(1));
  localStorage.setItem('cameraTarget', JSON.stringify({ x: 4, y: 5, z: 6 }));
  const cam = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, zoom: 0 };
  const ctrls = { target: { x: 0, y: 0, z: 0 }, update: vi.fn() };
  SceneManager.prototype.loadCamera.call({ camera: cam, controls: ctrls } as any);
  expect(ctrls.update).toHaveBeenCalledTimes(1);
  expect(cam.position.x).toBe(1);
  localStorage.clear();
});

// Reference createColorMaterial so the import is used even if tree-shaking is aggressive.
test('createColorMaterial produces uniforms (sanity)', () => {
  const m = createColorMaterial(0x00ff00, 0.4, 1.3, 1.3);
  expect(m.uniforms.uColor).toBeDefined();
});

test('color getters and setters', () => {
  const sm = makeSM({ scene: {}, materials: [] });

  sm.backgroundColor = '#111111';
  expect(sm.backgroundColor).toBeInstanceOf(Color);

  sm.travelColor = '#222222';
  expect(sm.travelColor).toBeInstanceOf(Color);

  sm.topLayerColor = '#333333';
  expect(sm.topLayerColor).toBeInstanceOf(Color);
  sm.topLayerColor = undefined;
  expect(sm.topLayerColor).toBeUndefined();

  sm.lastSegmentColor = '#444444';
  expect(sm.lastSegmentColor).toBeInstanceOf(Color);
  sm.lastSegmentColor = undefined;
  expect(sm.lastSegmentColor).toBeUndefined();

  sm._extrusionColor = new Color('white');
  expect(sm.extrusionColor).toBeInstanceOf(Color);

  sm._startLayer = 3;
  expect(sm.startLayer).toBe(3);
});

test('boundingBoxColor setter re-renders the bounding box', () => {
  const renderBoundingBox = vi.fn();
  const sm = makeSM({ renderBoundingBox });

  sm.boundingBoxColor = '#ff0000';
  expect(sm.boundingBoxColor).toBeInstanceOf(Color);

  sm.boundingBoxColor = undefined;
  expect(sm.boundingBoxColor).toBeUndefined();

  expect(renderBoundingBox).toHaveBeenCalledTimes(2);
});

test('light getters/setters update material uniforms', () => {
  const mat = {
    uniforms: {
      ambient: { value: 0 },
      directional: { value: 0 },
      brightness: { value: 0 }
    }
  };
  const sm = makeSM({ materials: [mat], _ambientLight: 0, _directionalLight: 0, _brightness: 0 });

  sm.ambientLight = 0.5;
  expect(sm.ambientLight).toBe(0.5);
  expect(mat.uniforms.ambient.value).toBe(0.5);

  sm.directionalLight = 0.6;
  expect(sm.directionalLight).toBe(0.6);
  expect(mat.uniforms.directional.value).toBe(0.6);

  sm.brightness = 0.7;
  expect(sm.brightness).toBe(0.7);
  expect(mat.uniforms.brightness.value).toBe(0.7);
});

test('updateClippingPlanes iterates shader materials', () => {
  const mat = { uniforms: { clipMinY: { value: 0 }, clipMaxY: { value: 0 } } };
  const sm = makeSM({
    job: {
      layers: [
        { z: 1, height: 0.2 },
        { z: 2, height: 0.2 }
      ]
    },
    _startLayer: 1,
    _endLayer: 2,
    materials: [mat],
    scene: { traverse: () => {} }
  });
  proto('updateClippingPlanes').call(sm);
  expect(mat.uniforms.clipMaxY.value).toBe(2);
});

test('updateLineClipping applies clipping planes to LineSegments2', () => {
  const seg = new LineSegments2();
  const sm = makeSM({ scene: { traverse: (cb: (o: unknown) => void) => cb(seg) } });
  proto('updateLineClipping').call(sm, 0, 10);
  expect((seg.material as any).clippingPlanes.length).toBe(2);
});

test('createGroup positions with and without a build volume', () => {
  const withVolume = makeSM({ _buildVolume: { x: 100, y: 100, z: 100 } });
  expect((proto('createGroup').call(withVolume, 'a') as any).name).toBe('a');

  const withoutVolume = makeSM({ _buildVolume: undefined });
  const g = proto('createGroup').call(withoutVolume, 'b') as any;
  expect(g.name).toBe('b');
  expect(g.position.x).toBe(-100);
});

test('renderAnimated branches', async () => {
  const mk = (pathsLength: number) =>
    makeSM({
      job: { paths: { length: pathsLength } },
      initScene: vi.fn(),
      render: vi.fn(),
      renderFrameLoop: vi.fn(() => Promise.resolve()),
      renderPathIndex: 0
    });

  // No arg -> default + nullish coalesce right side; many paths -> frame loop.
  const a = mk(120);
  await a.renderAnimated();
  expect(a.renderFrameLoop).toHaveBeenCalledWith(2);

  // Explicit pathCount, single path -> straight render.
  const b = mk(1);
  await b.renderAnimated(5);
  expect(b.render).toHaveBeenCalledTimes(1);

  // pathCount 0 -> conditional false side (defaults to 1).
  const c = mk(120);
  await c.renderAnimated(0);
  expect(c.renderFrameLoop).toHaveBeenCalledWith(1);
});

test('renderFrameLoop renders frames until complete', async () => {
  const sm = makeSM({
    job: { paths: { length: 10 } },
    renderPathIndex: 0,
    renderFrame: vi.fn(function (this: any) {
      this.renderPathIndex = 9;
    })
  });
  await proto('renderFrameLoop').call(sm, 3);
  expect(sm.renderFrame).toHaveBeenCalledTimes(1);
});

test('render creates a group when none exists', () => {
  const fresh = makeSM({
    group: undefined,
    createGroup: vi.fn(() => ({})),
    initScene: vi.fn(),
    renderPaths: vi.fn(),
    renderBoundingBox: vi.fn(),
    scene: { add: vi.fn() },
    renderer: { render: vi.fn() },
    camera: {},
    _boundingBoxColor: undefined
  });
  SceneManager.prototype.render.call(fresh);
  expect(fresh.createGroup).toHaveBeenCalledTimes(1);
});

test('renderPaths renders travel and extrusion as lines and tubes', () => {
  const renderPathsAsLines = vi.fn();
  const renderPathsAsTubes = vi.fn();

  // travel + extrusion, single color, as lines.
  const asLines = makeSM({
    renderTravel: true,
    renderExtrusion: true,
    renderTubes: false,
    job: { travels: [], toolPaths: [[], []] },
    renderPathIndex: 0,
    _travelColor: new Color(),
    _extrusionColor: new Color(),
    renderPathsAsLines,
    renderPathsAsTubes
  });
  proto('renderPaths').call(asLines, 5);
  expect(renderPathsAsLines).toHaveBeenCalled();

  // extrusion only, per-tool color array, as tubes.
  const asTubes = makeSM({
    renderTravel: false,
    renderExtrusion: true,
    renderTubes: true,
    job: { toolPaths: [[]] },
    renderPathIndex: 0,
    _extrusionColor: [new Color()],
    renderPathsAsLines,
    renderPathsAsTubes
  });
  proto('renderPaths').call(asTubes, 5);
  expect(renderPathsAsTubes).toHaveBeenCalled();
});

test('renderPathsAsLines builds and attaches line geometry', () => {
  const add = vi.fn();
  const sm = makeSM({
    job: { layers: [{ z: 1 }, { z: 2 }] },
    _startLayer: 1,
    _endLayer: 2,
    lineWidth: 1,
    lineHeight: 0.2,
    disposables: [],
    currentChunk: { add }
  });
  const paths = [{ vertices: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] }];
  proto('renderPathsAsLines').call(sm, paths as any, new Color('red'));
  expect(add).toHaveBeenCalledTimes(1);
  expect(sm.disposables.length).toBe(2);
});

test('createBoundingBox builds a LineBox at the min corner', () => {
  const sm = makeSM({
    job: {
      boundingBox: {
        size: new Vector3(10, 20, 5),
        corners: { min: { toVector3: () => new Vector3(1, 2, 3) } }
      }
    },
    _boundingBoxColor: new Color('red')
  });
  const mesh = proto('createBoundingBox').call(sm) as any;
  expect(mesh.position.x).toBe(1);
});

test('clear resets layers, mode and job', () => {
  const sm = makeSM({
    job: { countLayers: 5, layers: [] },
    materials: [],
    scene: { traverse: () => {} },
    _startLayer: 2,
    _endLayer: 3,
    _singleLayerMode: true,
    prevStartLayer: 0
  });
  proto('clear').call(sm);
  expect(sm.job).toBeUndefined();
  expect(sm.singleLayerMode).toBe(false);
});

test('saveCamera and clearCamera round-trip through localStorage', () => {
  localStorage.clear();
  const sm = makeSM({
    camera: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, zoom: 1 },
    controls: { target: { x: 0, y: 0, z: 0 } }
  });

  proto('saveCamera').call(sm);
  expect(localStorage.getItem('cameraPosition')).toBeTruthy();

  proto('clearCamera').call(sm);
  expect(localStorage.getItem('cameraPosition')).toBeNull();
});

/* eslint-disable @typescript-eslint/no-explicit-any */

import { test, expect, vi, afterEach, beforeEach } from 'vitest';

import { SceneManager, SceneManagerOptions } from '../scene-manager';
import { Job } from '../job';
import { Parser } from '../gcode-parser';
import { Interpreter } from '../interpreter';
import { Path, PathType } from '../path';
import { BatchedMesh, Color, OrthographicCamera, PerspectiveCamera } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

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

// Only the WebGLRenderer is replaced so real SceneManager instances can be
// constructed without a GPU. Every other three.js class stays real, so cameras,
// materials, geometries and OrbitControls are the actual implementations.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// Three z-heights, two extrusions each, with travel moves in between.
const LAYERED_GCODE = [
  'G0 X0 Y0 Z0.2',
  'G1 X10 Y0 E1',
  'G1 X10 Y10 E2',
  'G0 X0 Y0 Z0.4',
  'G1 X10 Y0 E3',
  'G1 X10 Y10 E4',
  'G0 X0 Y0 Z0.6',
  'G1 X10 Y0 E5',
  'G1 X10 Y10 E6'
].join('\n');

function jobFromGCode(gcode: string): Job {
  const job = new Job();
  const { commands } = new Parser().parseGCode(gcode);
  new Interpreter().execute(commands, job);
  return job;
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(canvas, 'offsetHeight', { value: 600, configurable: true });
  return canvas;
}

const managers: SceneManager[] = [];

function createSceneManager(opts: Partial<SceneManagerOptions> = {}, job = new Job(), onFrame?: () => void) {
  const sm = new SceneManager(
    { canvas: createCanvas(), buildVolume: { x: 200, y: 200, z: 200, smallGrid: false }, ...opts },
    job,
    onFrame
  );
  managers.push(sm);
  return sm;
}

function lastRenderer() {
  return mockRenderers[mockRenderers.length - 1];
}

function collect<T>(sm: SceneManager, matches: (obj: unknown) => obj is T): T[] {
  const found: T[] = [];
  sm.scene.traverse((obj) => {
    if (matches(obj)) found.push(obj);
  });
  return found;
}

const isLine = (obj: unknown): obj is LineSegments2 => obj instanceof LineSegments2;
const isBatchedMesh = (obj: unknown): obj is BatchedMesh => obj instanceof BatchedMesh;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The animate loop's controls.update() drifts positions by ~1e-14 per frame,
// so camera coordinates are compared with a tolerance.
function expectVectorCloseTo(actual: { toArray(): number[] }, expected: number[]) {
  const values = actual.toArray();
  expect(values).toHaveLength(expected.length);
  values.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  managers.forEach((sm) => sm.dispose());
  managers.length = 0;
  mockRenderers.length = 0;
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

test('constructor applies explicit options to the instance state', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager(
    {
      backgroundColor: '#123456',
      buildVolume: { x: 150, y: 100, z: 90, smallGrid: true },
      boundingBoxColor: '#ff0000',
      extrusionColor: ['#00ff00', '#0000ff'],
      travelColor: '#336699',
      topLayerColor: '#fedcba',
      lastSegmentColor: '#446688',
      toolColors: { 0: '#aaaaaa', 1: '#bbbbbb' },
      disableGradient: true,
      startLayer: 1,
      endLayer: 2,
      lineWidth: 3,
      lineHeight: 0.3,
      renderExtrusion: false,
      renderTravel: true,
      renderTubes: true,
      extrusionWidth: 0.5,
      nonTravelMoves: ['G10'],
      initialCameraPosition: [10, 20, 30]
    },
    job
  );

  expect(sm.travelColor.getHex()).toBe(0x336699);
  expect((sm.topLayerColor as Color).getHex()).toBe(0xfedcba);
  expect(sm.backgroundColor.getHex()).toBe(0x123456);
  expect((sm.scene.background as Color).getHex()).toBe(0x123456);
  expect((sm.extrusionColor as Color[]).map((c) => c.getHex())).toEqual([0x00ff00, 0x0000ff]);
  expect((sm.lastSegmentColor as Color).getHex()).toBe(0x446688);
  expect((sm.boundingBoxColor as Color).getHex()).toBe(0xff0000);
  expect((sm as any)._toolColors[0].getHex()).toBe(0xaaaaaa);
  expect((sm as any)._toolColors[1].getHex()).toBe(0xbbbbbb);

  expect(sm.buildVolume?.x).toBe(150);
  expect(sm.buildVolume?.y).toBe(100);
  expect(sm.buildVolume?.z).toBe(90);
  expect(sm.buildVolume?.smallGrid).toBe(true);

  expect(sm.startLayer).toBe(1);
  expect(sm.endLayer).toBe(2);
  expect(sm.lineWidth).toBe(3);
  expect(sm.lineHeight).toBe(0.3);
  expect(sm.renderExtrusion).toBe(false);
  expect(sm.renderTravel).toBe(true);
  expect(sm.renderTubes).toBe(true);
  expect(sm.extrusionWidth).toBe(0.5);
  expect(sm.nonTravelmoves).toEqual(['G10']);
  expect(sm.disableGradient).toBe(true);
  expectVectorCloseTo(sm.camera.position, [10, 20, 30]);
  // the controls aim at the center of the build volume
  expect(sm.controls.target.x).toBeCloseTo(75, 6);
  expect(sm.controls.target.z).toBeCloseTo(-50, 6);
});

test('constructor falls back to documented defaults when options are omitted', () => {
  const sm = createSceneManager();

  expect(sm.backgroundColor.getHex()).toBe(0xe0e0e0);
  expect(sm.travelColor.getHex()).toBe(0x990000);
  expect(sm.topLayerColor).toBeUndefined();
  expect(sm.lastSegmentColor).toBeUndefined();
  expect(sm.boundingBoxColor).toBeUndefined();
  expect((sm.extrusionColor as Color).getHex()).toBe(new Color('hotpink').getHex());
  expect(sm.lineWidth).toBe(1);
  expect(sm.lineHeight).toBe(0.2);
  expect(sm.startLayer).toBeUndefined();
  expect(sm.endLayer).toBeUndefined();
  expect(sm.renderExtrusion).toBe(true);
  expect(sm.renderTravel).toBe(false);
  expect(sm.renderTubes).toBe(false);
  expect(sm.disableGradient).toBe(false);
  expect(sm.nonTravelmoves).toEqual([]);

  expect(sm.camera).toBeInstanceOf(PerspectiveCamera);
  expect((sm.camera as PerspectiveCamera).aspect).toBeCloseTo(800 / 600);
  expectVectorCloseTo(sm.camera.position, [-100, 400, 450]);
  expect(sm.controls.target.x).toBeCloseTo(100, 6);
  expect(sm.controls.target.z).toBeCloseTo(-100, 6);

  // resize() configured the renderer for the canvas
  expect(lastRenderer().setSize).toHaveBeenCalledWith(800, 600, false);
  expect(lastRenderer().setPixelRatio).toHaveBeenCalledWith(window.devicePixelRatio);
  expect(lastRenderer().localClippingEnabled).toBe(true);
});

test('constructor without a canvas throws', () => {
  expect(() => new SceneManager({} as SceneManagerOptions, new Job())).toThrow('Set either');
});

test('constructor without a build volume throws while centering the controls', () => {
  // Current behavior: the constructor dereferences this._buildVolume
  // unconditionally when aiming the controls, so a missing buildVolume option
  // fails construction. If this starts passing, the constructor learned to
  // handle it and this test should assert the new behavior instead.
  expect(() => new SceneManager({ canvas: createCanvas() }, new Job())).toThrow(TypeError);
});

test('constructor creates an orthographic camera when requested', () => {
  const sm = createSceneManager({ orthographic: true });

  expect(sm.orthographic).toBe(true);
  expect(sm.camera).toBeInstanceOf(OrthographicCamera);
  // frustum derived from the 200mm build volume: 200 * 1.2 padding / 2
  const camera = sm.camera as OrthographicCamera;
  expect(camera.top).toBe(120);
  expect(camera.bottom).toBe(-120);
  expect(camera.right).toBeCloseTo(120 * (800 / 600));
});

// ---------------------------------------------------------------------------
// Property getters/setters
// ---------------------------------------------------------------------------

test('buildVolume setter replaces the volume and clears it on undefined', () => {
  const sm = createSceneManager();

  sm.buildVolume = { x: 10, y: 20, z: 30, smallGrid: true };
  expect(sm.buildVolume?.x).toBe(10);
  expect(sm.buildVolume?.y).toBe(20);
  expect(sm.buildVolume?.z).toBe(30);

  const previous = sm.buildVolume!;
  const disposeSpy = vi.spyOn(previous, 'dispose');
  sm.buildVolume = undefined;
  expect(sm.buildVolume).toBeUndefined();
  expect(disposeSpy).toHaveBeenCalledTimes(1);

  // clearing an already-cleared volume is a no-op
  sm.buildVolume = undefined;
  expect(sm.buildVolume).toBeUndefined();
});

test('backgroundColor setter recolors the scene background', () => {
  const sm = createSceneManager();
  sm.backgroundColor = '#111111';
  expect(sm.backgroundColor.getHex()).toBe(0x111111);
  expect((sm.scene.background as Color).getHex()).toBe(0x111111);
});

test('color setters store the exact color and clear on undefined', () => {
  const sm = createSceneManager();

  sm.travelColor = '#222222';
  expect(sm.travelColor.getHex()).toBe(0x222222);

  sm.topLayerColor = '#333333';
  expect((sm.topLayerColor as Color).getHex()).toBe(0x333333);
  sm.topLayerColor = undefined;
  expect(sm.topLayerColor).toBeUndefined();

  sm.lastSegmentColor = '#444444';
  expect((sm.lastSegmentColor as Color).getHex()).toBe(0x444444);
  sm.lastSegmentColor = undefined;
  expect(sm.lastSegmentColor).toBeUndefined();
});

test('extrusionColor setter with an array creates one material per color', () => {
  const sm = createSceneManager();

  sm.extrusionColor = ['#ff0000', '#00ff00'];
  expect((sm.extrusionColor as Color[]).map((c) => c.getHex())).toEqual([0xff0000, 0x00ff00]);
  const materials = (sm as any).materials;
  expect(materials).toHaveLength(2);
  expect(materials[0].uniforms.uColor.value.getHex()).toBe(0xff0000);
  expect(materials[1].uniforms.uColor.value.getHex()).toBe(0x00ff00);

  // an existing material is reused: only its uniform is updated
  const first = materials[0];
  sm.extrusionColor = ['#123456'];
  expect((sm as any).materials[0]).toBe(first);
  expect(first.uniforms.uColor.value.getHex()).toBe(0x123456);
});

test('extrusionColor setter with a single color updates material 0', () => {
  const sm = createSceneManager();

  sm.extrusionColor = '#abcdef';
  expect((sm.extrusionColor as Color).getHex()).toBe(0xabcdef);
  const materials = (sm as any).materials;
  expect(materials).toHaveLength(1);
  expect(materials[0].uniforms.uColor.value.getHex()).toBe(0xabcdef);

  const first = materials[0];
  sm.extrusionColor = '#00ff00';
  expect((sm as any).materials[0]).toBe(first);
  expect(first.uniforms.uColor.value.getHex()).toBe(0x00ff00);
});

test('extrusionColor setter tolerates a material without uniforms', () => {
  // The `material && material.uniforms` guard is unreachable through the public
  // API (createColorMaterial always produces uniforms), so a malformed material
  // is injected directly to cover the guard's false side.
  const sm = createSceneManager();
  (sm as any).materials[0] = {};
  sm.extrusionColor = ['#202020'];
  expect((sm.extrusionColor as Color[])[0].getHex()).toBe(0x202020);
});

test('light setters update the shader material uniforms', () => {
  const sm = createSceneManager({ renderTubes: true }, jobFromGCode(LAYERED_GCODE));
  sm.render();
  const material = (sm as any).materials[0];

  sm.ambientLight = 0.5;
  expect(sm.ambientLight).toBe(0.5);
  expect(material.uniforms.ambient.value).toBe(0.5);

  sm.directionalLight = 0.6;
  expect(sm.directionalLight).toBe(0.6);
  expect(material.uniforms.directional.value).toBe(0.6);

  sm.brightness = 0.7;
  expect(sm.brightness).toBe(0.7);
  expect(material.uniforms.brightness.value).toBe(0.7);
});

// ---------------------------------------------------------------------------
// Layer range and clipping
// ---------------------------------------------------------------------------

test('start and end layer setters validate against the job layers', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({}, job);
  expect(job.countLayers).toBe(3);

  sm.endLayer = 99;
  expect(sm.endLayer).toBe(3); // clamped to the layer count

  sm.endLayer = 2;
  expect(sm.endLayer).toBe(2);
  sm.startLayer = 1;
  expect(sm.startLayer).toBe(1);

  sm.startLayer = 99; // out of range resets to undefined
  expect(sm.startLayer).toBeUndefined();
  sm.startLayer = 0; // not a valid 1-based index
  expect(sm.startLayer).toBeUndefined();
  sm.endLayer = undefined;
  expect(sm.endLayer).toBeUndefined();
});

test('layer range applies clipping planes to rendered lines', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ renderTravel: true }, job);
  sm.render();

  const line = collect(sm, isLine)[0];
  expect(line).toBeDefined();
  // no layer range: no clipping planes on the freshly built material
  expect(line.material.clippingPlanes).toHaveLength(0);

  sm.startLayer = 2;
  sm.endLayer = 3;
  const planes = line.material.clippingPlanes!;
  expect(planes).toHaveLength(2);
  const start = job.layers[1];
  const end = job.layers[2];
  expect(planes[0].normal.y).toBe(1);
  expect(planes[0].constant).toBeCloseTo(-(start.z - start.height));
  expect(planes[1].normal.y).toBe(-1);
  expect(planes[1].constant).toBeCloseTo(end.z);

  // non-line scene objects (the build volume grid) are left untouched
  sm.scene.traverse((obj) => {
    const material = (obj as any).material;
    if (material && !(obj instanceof LineSegments2)) {
      expect(material.clippingPlanes ?? null).toBeNull();
    }
  });

  // a re-render bakes the active range into the new line material
  sm.render();
  const newLine = collect(sm, isLine)[0];
  expect(newLine.material.clippingPlanes).toHaveLength(2);
});

test('layer range updates the clipping uniforms of tube materials', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ renderTubes: true }, job);
  sm.render();
  const material = (sm as any).materials[0];

  sm.startLayer = 2;
  sm.endLayer = 2;
  expect(material.uniforms.clipMinY.value).toBeCloseTo(job.layers[1].z - job.layers[1].height);
  expect(material.uniforms.clipMaxY.value).toBeCloseTo(job.layers[1].z);
});

test('singleLayerMode pins startLayer to the layer below endLayer', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ startLayer: 1, endLayer: 3 }, job);

  sm.singleLayerMode = true;
  expect(sm.singleLayerMode).toBe(true);
  expect(sm.startLayer).toBe(2);

  // setting the same value again must not clobber the remembered start layer
  sm.singleLayerMode = true;
  expect(sm.startLayer).toBe(2);

  // while in single layer mode, endLayer drags startLayer along
  sm.endLayer = 2;
  expect(sm.startLayer).toBe(1);
  sm.endLayer = 3;
  expect(sm.startLayer).toBe(2);

  // leaving the mode restores the original start layer
  sm.singleLayerMode = false;
  expect(sm.singleLayerMode).toBe(false);
  expect(sm.startLayer).toBe(1);
});

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

test('orthographic setter swaps cameras preserving position and target', () => {
  const sm = createSceneManager();
  const initialCamera = sm.camera;
  sm.camera.position.set(5, 6, 7);
  sm.controls.target.set(1, 2, 3);

  // no change requested: the camera instance stays the same
  sm.orthographic = false;
  expect(sm.camera).toBe(initialCamera);

  sm.orthographic = true;
  expect(sm.camera).toBeInstanceOf(OrthographicCamera);
  expectVectorCloseTo(sm.camera.position, [5, 6, 7]);
  expectVectorCloseTo(sm.controls.target, [1, 2, 3]);
  expect(sm.controls.screenSpacePanning).toBe(true);

  sm.orthographic = false;
  expect(sm.camera).toBeInstanceOf(PerspectiveCamera);
  expect((sm.camera as PerspectiveCamera).aspect).toBeCloseTo(800 / 600);
  expectVectorCloseTo(sm.camera.position, [5, 6, 7]);
});

test('orthographic frustum uses the model bounding box, then the default size', () => {
  const withModel = createSceneManager({}, jobFromGCode(LAYERED_GCODE));
  withModel.orthographic = true;
  const size = withModel.job.boundingBox.size!;
  const expected = (Math.max(size.x, size.y, size.z) * 1.2) / 2;
  expect((withModel.camera as OrthographicCamera).top).toBeCloseTo(expected);

  // no model and no build volume: fall back to the default 500 frustum
  const bare = createSceneManager();
  bare.buildVolume = undefined;
  bare.orthographic = true;
  expect((bare.camera as OrthographicCamera).top).toBe(250);
});

test('saveCamera round-trips through loadCamera and clearCamera wipes it', () => {
  const sm = createSceneManager();
  sm.camera.position.set(1, 2, 3);
  sm.controls.target.set(4, 5, 6);
  sm.camera.zoom = 2;
  sm.saveCamera();
  expect(JSON.parse(localStorage.getItem('cameraPosition')!)).toMatchObject({ x: 1, y: 2, z: 3 });
  expect(JSON.parse(localStorage.getItem('cameraTarget')!)).toMatchObject({ x: 4, y: 5, z: 6 });
  expect(JSON.parse(localStorage.getItem('cameraZoom')!)).toBe(2);

  sm.camera.position.set(0, 0, 0);
  sm.controls.target.set(0, 0, 0);
  sm.camera.zoom = 1;
  sm.loadCamera();
  expectVectorCloseTo(sm.camera.position, [1, 2, 3]);
  expectVectorCloseTo(sm.controls.target, [4, 5, 6]);
  expect(sm.camera.zoom).toBe(2);

  sm.clearCamera();
  expect(localStorage.getItem('cameraPosition')).toBeNull();
  expect(localStorage.getItem('cameraRotation')).toBeNull();
  expect(localStorage.getItem('cameraZoom')).toBeNull();
  expect(localStorage.getItem('cameraTarget')).toBeNull();
});

test('loadCamera leaves the camera alone when storage is incomplete', () => {
  const sm = createSceneManager();
  localStorage.setItem('cameraPosition', JSON.stringify({ x: 9, y: 9, z: 9 }));
  sm.camera.position.set(1, 1, 1);
  sm.loadCamera();
  expect(sm.camera.position.toArray()).toEqual([1, 1, 1]);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test('render populates the scene with travel and extrusion lines', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager(
    { renderTravel: true, travelColor: '#123456', extrusionColor: '#ff0000', lineWidth: 4 },
    job
  );
  sm.render();

  const group = sm.scene.getObjectByName('allLayers')!;
  expect(group).toBeDefined();
  expect(group.position.x).toBe(0); // a build volume is present, no crude centering

  const lines = collect(sm, isLine);
  expect(lines).toHaveLength(2); // one merged travel line, one extrusion line
  const hexes = lines.map((l) => l.material.color.getHex());
  expect(hexes).toContain(0x123456);
  expect(hexes).toContain(0xff0000);
  expect(lines.map((l) => l.material.linewidth)).toEqual([4, 4]);

  // a second render replaces the model instead of stacking a duplicate
  const childCount = group.children.length;
  sm.render();
  expect(sm.scene.getObjectByName('allLayers')).toBe(group);
  expect(group.children.length).toBe(childCount);
  expect(collect(sm, isLine)).toHaveLength(2);

  // the draw call went to the renderer with the real scene and camera
  expect(lastRenderer().render).toHaveBeenCalledWith(sm.scene, sm.camera);
});

test('render with travel and extrusion disabled leaves the group empty', () => {
  const sm = createSceneManager({ renderExtrusion: false, renderTravel: false }, jobFromGCode(LAYERED_GCODE));
  sm.render();
  expect(sm.scene.getObjectByName('allLayers')!.children).toHaveLength(0);
});

test('render as tubes creates a batched mesh with the per-tool color', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ renderTubes: true, extrusionColor: ['#00ff00'] }, job);
  sm.render();

  const meshes = collect(sm, isBatchedMesh);
  expect(meshes).toHaveLength(1);
  expect((meshes[0].material as any).uniforms.uColor.value.getHex()).toBe(0x00ff00);
});

test('render falls back to a configured color when a tool has none of its own', () => {
  // T2 selects a tool index one past the single color supplied, which used to
  // read extrusionColor[2] as undefined and throw inside renderPathsAsTubes.
  const job = jobFromGCode(['T2', ...LAYERED_GCODE.split('\n')].join('\n'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sm = createSceneManager({ renderTubes: true, extrusionColor: ['#00ff00'] }, job);

  expect(() => sm.render()).not.toThrow();

  const meshes = collect(sm, isBatchedMesh);
  expect(meshes).toHaveLength(1);
  expect((meshes[0].material as any).uniforms.uColor.value.getHex()).toBe(0x00ff00);
  expect(warn).toHaveBeenCalledWith('No extrusionColor configured for tool index 2, falling back to another color');
  warn.mockRestore();
});

test('render only warns once per tool index missing a configured color', () => {
  const job = jobFromGCode(['T2', ...LAYERED_GCODE.split('\n')].join('\n'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sm = createSceneManager({ renderTubes: true, extrusionColor: ['#00ff00'] }, job);

  sm.render();
  sm.render();

  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('render falls back to the default extrusion color when no colors are configured at all', () => {
  const job = jobFromGCode(['T2', ...LAYERED_GCODE.split('\n')].join('\n'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sm = createSceneManager({ renderTubes: true, extrusionColor: [] }, job);

  expect(() => sm.render()).not.toThrow();

  const meshes = collect(sm, isBatchedMesh);
  expect((meshes[0].material as any).uniforms.uColor.value.getHex()).toBe(
    SceneManager.defaultExtrusionColor.getHex()
  );
  warn.mockRestore();
});

test('paths too short for a tube geometry are skipped', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const stub = new Path(PathType.Extrusion);
  stub.addPoint(1, 2, 3); // a single point cannot produce a geometry
  job.toolPaths[0].push(stub);

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sm = createSceneManager({ renderTubes: true }, job);
  sm.render();
  expect(warn).toHaveBeenCalledWith('Path has less than 6 points, returning empty geometry');
  expect(collect(sm, isBatchedMesh)).toHaveLength(1);
  warn.mockRestore();
});

test('createGroup centers crudely when there is no build volume', () => {
  const sm = createSceneManager({}, jobFromGCode(LAYERED_GCODE));
  sm.buildVolume = undefined;
  sm.render();
  const group = sm.scene.getObjectByName('allLayers')!;
  expect(group.position.x).toBe(-100);
  expect(group.position.z).toBe(100);
});

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

test('boundingBoxColor setter shows, recolors and hides the bounding box', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({}, job);

  sm.boundingBoxColor = '#ff0000';
  const mesh = sm.scene.getObjectByName('bounding-box') as any;
  expect(mesh).toBeDefined();
  expect(mesh.visible).toBe(true);
  expect(mesh.material.color.getHex()).toBe(0xff0000);
  // positioned at the model's min corner
  const min = job.boundingBox.corners.min;
  expect(mesh.position.x).toBeCloseTo(min.x);

  // recoloring reuses the existing mesh
  sm.boundingBoxColor = '#00ff00';
  expect(sm.scene.getObjectByName('bounding-box')).toBe(mesh);
  expect(mesh.material.color.getHex()).toBe(0x00ff00);

  sm.boundingBoxColor = undefined;
  expect(sm.boundingBoxColor).toBeUndefined();
  expect(mesh.visible).toBe(false);
});

test('render draws the bounding box only when a color is set', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const without = createSceneManager({}, job);
  without.render();
  expect(without.scene.getObjectByName('bounding-box')).toBeUndefined();

  const with_ = createSceneManager({ boundingBoxColor: '#0000ff' }, jobFromGCode(LAYERED_GCODE));
  with_.render();
  const mesh = with_.scene.getObjectByName('bounding-box') as any;
  expect(mesh.visible).toBe(true);
  expect(mesh.material.color.getHex()).toBe(0x0000ff);
});

test('the bounding box is skipped without a job or with an invalid bounding box', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});

  // an empty job has an invalid (never-updated) bounding box
  const sm = createSceneManager();
  sm.boundingBoxColor = '#ff0000';
  expect(err).toHaveBeenCalledWith('Invalid bounding box, skipping rendering');
  expect(sm.scene.getObjectByName('bounding-box')).toBeUndefined();

  err.mockClear();
  sm.job = undefined as any;
  sm.boundingBoxColor = '#00ff00';
  expect(err).not.toHaveBeenCalled();
  expect(sm.scene.getObjectByName('bounding-box')).toBeUndefined();
  err.mockRestore();
});

// ---------------------------------------------------------------------------
// Animated rendering
// ---------------------------------------------------------------------------

test('renderAnimated builds the model incrementally in chunks', async () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ boundingBoxColor: '#ff0000' }, job);

  await sm.renderAnimated(2);

  const group = sm.scene.getObjectByName('allLayers')!;
  const chunks = group.children.filter((c) => c.name.startsWith('chunk'));
  expect(chunks.length).toBe(Math.ceil((job.paths.length - 1) / 2));
  expect(collect(sm, isLine).length).toBeGreaterThan(0);
  // the bounding box branch of renderFrame ran too
  expect((sm.scene.getObjectByName('bounding-box') as any).visible).toBe(true);

  // a full render afterwards tears the chunk tree down again
  sm.render();
  expect(group.children.filter((c) => c.name.startsWith('chunk'))).toHaveLength(0);
  expect(collect(sm, isLine)).toHaveLength(1); // just the single re-rendered extrusion line
});

test('renderAnimated defaults to one path per frame for small jobs', async () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({}, job);
  await sm.renderAnimated(); // paths/60 rounds down to 0, coerced to 1
  const group = sm.scene.getObjectByName('allLayers')!;
  expect(group.children.filter((c) => c.name.startsWith('chunk'))).toHaveLength(job.paths.length - 1);

  const explicitZero = createSceneManager({}, jobFromGCode(LAYERED_GCODE));
  await explicitZero.renderAnimated(0); // an explicit 0 is coerced to 1 as well
  const group2 = explicitZero.scene.getObjectByName('allLayers')!;
  expect(group2.children.filter((c) => c.name.startsWith('chunk'))).toHaveLength(job.paths.length - 1);
});

test('renderAnimated falls back to a direct render for an empty job', async () => {
  const sm = createSceneManager({}, new Job());
  await sm.renderAnimated(5);
  const group = sm.scene.getObjectByName('allLayers')!;
  expect(group).toBeDefined();
  expect(group.children.filter((c) => c.name.startsWith('chunk'))).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Animation loop and disposal
// ---------------------------------------------------------------------------

test('the animate loop renders the scene continuously and reports frames', async () => {
  const onFrame = vi.fn();
  const sm = createSceneManager({}, new Job(), onFrame);
  const renderer = lastRenderer();

  await wait(50);

  expect(renderer.render).toHaveBeenCalledWith(sm.scene, sm.camera);
  expect(renderer.render.mock.calls.length).toBeGreaterThan(2);
  expect(onFrame.mock.calls.length).toBeGreaterThan(2);
});

test('dispose stops the render loop and releases resources', async () => {
  const sm = createSceneManager();
  const renderer = lastRenderer();
  const controlsDispose = vi.spyOn(sm.controls, 'dispose');
  const volumeDispose = vi.spyOn(sm.buildVolume!, 'dispose');

  await wait(30);
  sm.dispose();

  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(controlsDispose).toHaveBeenCalledTimes(1);
  // the volume is registered as a disposable twice: once by the constructor
  // and once more by the initScene call at the end of construction
  expect(volumeDispose).toHaveBeenCalledTimes(2);
  expect((sm as any).disposables).toHaveLength(0);

  const callsAfterDispose = renderer.render.mock.calls.length;
  await wait(50);
  expect(renderer.render.mock.calls.length).toBe(callsAfterDispose);

  // a second dispose exercises cancelAnimation's no-scheduled-frame guard
  sm.dispose();
  expect(renderer.dispose).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test('clear resets the layer state and drops the job', () => {
  const job = jobFromGCode(LAYERED_GCODE);
  const sm = createSceneManager({ startLayer: 2, endLayer: 2 }, job);

  sm.clear();

  expect(sm.startLayer).toBeUndefined();
  expect(sm.endLayer).toBe(3); // Infinity clamped to the layer count before the job is dropped
  expect(sm.singleLayerMode).toBe(false);
  expect(sm.job).toBeUndefined();
});

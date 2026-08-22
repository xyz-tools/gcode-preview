import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';

// WebGL and OrbitControls cannot run under happy-dom, so only those two are stubbed.
// Everything else — the scene graph, materials, the ObjectsManager — is real.
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = { set: vi.fn(), x: 0, y: 0, z: 0 };
    update = vi.fn();
    dispose = vi.fn();
  }
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      localClippingEnabled = false;
      info = {
        render: { triangles: 0, calls: 0, lines: 0, points: 0 },
        memory: { geometries: 0, textures: 0 }
      };
      render = vi.fn();
      setSize = vi.fn();
      setPixelRatio = vi.fn();
      dispose = vi.fn();
    }
  };
});

import { SceneManager, type SceneManagerOptions } from '../scene-manager';
import { ObjectsManager } from '../objects-manager';
import { Job } from '../job';
import { Path, PathType } from '../path';
import { Color, Group } from 'three';

describe('SceneManager properties', () => {
  let sceneManager: SceneManager;

  beforeEach(() => {
    // the constructor logs the three.js revision and dumps the whole options
    // object, canvas included, which drowns out the test output
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    sceneManager = createSceneManager();
  });

  afterEach(() => {
    // stops the requestAnimationFrame loop started by the constructor
    sceneManager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('renderTravel', () => {
    test('builds and shows the travel moves when enabled', () => {
      sceneManager.renderTravel = true;

      expect(travelGroup(sceneManager).visible).toBe(true);
      expect(travelGroup(sceneManager).children.length).toBeGreaterThan(0);
    });

    test('hides the travel moves without discarding them', () => {
      sceneManager.renderTravel = true;
      const built = travelGroup(sceneManager).children.length;

      sceneManager.renderTravel = false;

      expect(travelGroup(sceneManager).visible).toBe(false);
      expect(travelGroup(sceneManager).children.length).toBe(built);
    });

    test('reuses the geometry when re-enabled', () => {
      sceneManager.renderTravel = true;
      const first = travelGroup(sceneManager).children[0];

      sceneManager.renderTravel = false;
      sceneManager.renderTravel = true;

      expect(travelGroup(sceneManager).children[0]).toBe(first);
    });

    test('reports the current value', () => {
      sceneManager.renderTravel = true;

      expect(sceneManager.renderTravel).toBe(true);
    });
  });

  describe('renderExtrusion', () => {
    test('hides the extrusions without discarding them', () => {
      const built = extrusionGroup(sceneManager).children.length;

      sceneManager.renderExtrusion = false;

      expect(extrusionGroup(sceneManager).visible).toBe(false);
      expect(extrusionGroup(sceneManager).children.length).toBe(built);
    });

    test('shows them again when re-enabled', () => {
      sceneManager.renderExtrusion = false;
      sceneManager.renderExtrusion = true;

      expect(extrusionGroup(sceneManager).visible).toBe(true);
      expect(sceneManager.renderExtrusion).toBe(true);
    });
  });

  describe('renderTubes', () => {
    test('reads through to the objects manager', () => {
      expect(sceneManager.renderTubes).toBe(objectsManager(sceneManager).renderTubes);
    });

    test('asks the objects manager to swap representation', () => {
      const spy = vi.spyOn(objectsManager(sceneManager), 'setRenderTubes');

      sceneManager.renderTubes = true;

      expect(spy).toHaveBeenCalledWith(true);
    });
  });

  describe('colors', () => {
    test('extrusionColor recolors without rebuilding', () => {
      const before = extrusionGroup(sceneManager).children[0];
      const color = new Color(0x00ff00);

      sceneManager.extrusionColor = color;

      expect(extrusionGroup(sceneManager).children[0]).toBe(before);
      expect(sceneManager.extrusionColor).toEqual(color);
    });

    test('an array extrusionColor gives each tool its own color when drawing', () => {
      sceneManager.extrusionColor = ['#ff0000', '#0000ff'];
      const spy = vi.spyOn(objectsManager(sceneManager), 'renderExtrusions');

      sceneManager.renderExtrusion = false;
      sceneManager.renderExtrusion = true;

      expect(spy).toHaveBeenCalledWith(expect.anything(), new Color('#ff0000'), 0);
    });

    test('extrusionColor accepts an array, one entry per tool', () => {
      const spy = vi.spyOn(objectsManager(sceneManager), 'setExtrusionColor');

      sceneManager.extrusionColor = ['#ff0000', '#0000ff'];

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith(new Color('#0000ff'), 1);
      expect(sceneManager.extrusionColor).toEqual([new Color('#ff0000'), new Color('#0000ff')]);
    });

    test('travelColor recolors the travel lines', () => {
      sceneManager.renderTravel = true;
      const spy = vi.spyOn(objectsManager(sceneManager), 'setTravelColor');

      sceneManager.travelColor = '#ff00ff';

      expect(spy).toHaveBeenCalledWith(new Color('#ff00ff'));
      expect(sceneManager.travelColor).toEqual(new Color('#ff00ff'));
    });

    test('backgroundColor updates the scene background', () => {
      sceneManager.backgroundColor = '#123456';

      expect(sceneManager.scene.background).toEqual(new Color('#123456'));
      expect(sceneManager.backgroundColor).toEqual(new Color('#123456'));
    });

    test('topLayerColor round-trips, and clears', () => {
      sceneManager.topLayerColor = '#abcdef';
      expect(sceneManager.topLayerColor).toEqual(new Color('#abcdef'));

      sceneManager.topLayerColor = undefined;
      expect(sceneManager.topLayerColor).toBeUndefined();
    });

    test('lastSegmentColor round-trips, and clears', () => {
      sceneManager.lastSegmentColor = '#abcdef';
      expect(sceneManager.lastSegmentColor).toEqual(new Color('#abcdef'));

      sceneManager.lastSegmentColor = undefined;
      expect(sceneManager.lastSegmentColor).toBeUndefined();
    });

    test('boundingBoxColor draws nothing for a job with no bounds', () => {
      const job = new Job();
      appendPath(job, PathType.Extrusion, [
        [0, 0, 0],
        [10, 0, 0]
      ]);
      const unbounded = createSceneManager({ job });

      unbounded.boundingBoxColor = '#00ff00';

      expect(unbounded.boundingBoxMesh).toBeUndefined();
      unbounded.dispose();
    });

    test('boundingBoxColor drives the bounding box visibility', () => {
      sceneManager.boundingBoxColor = '#00ff00';
      expect(sceneManager.boundingBoxMesh?.visible).toBe(true);
      expect(sceneManager.boundingBoxColor).toEqual(new Color('#00ff00'));

      sceneManager.boundingBoxColor = undefined;
      expect(sceneManager.boundingBoxMesh?.visible).toBe(false);
    });
  });

  describe('lighting', () => {
    test.each([
      ['ambientLight', 'setAmbientLight'],
      ['directionalLight', 'setDirectionalLight'],
      ['brightness', 'setBrightness']
    ] as const)('%s delegates to the objects manager', (property, method) => {
      const spy = vi.spyOn(objectsManager(sceneManager), method);

      sceneManager[property] = 0.42;

      expect(spy).toHaveBeenCalledWith(0.42);
      expect(sceneManager[property]).toBe(0.42);
    });
  });

  describe('dimensions', () => {
    test.each([
      ['lineWidth', 'setLineWidth', 3],
      ['lineHeight', 'setLineHeight', 0.5],
      ['extrusionWidth', 'setExtrusionWidth', 1.2]
    ] as const)('%s delegates to the objects manager', (property, method, value) => {
      const spy = vi.spyOn(objectsManager(sceneManager), method);

      sceneManager[property] = value;

      expect(spy).toHaveBeenCalledWith(value);
      expect(sceneManager[property]).toBe(value);
    });
  });

  describe('layer range', () => {
    test('startLayer clamps out-of-range values to undefined', () => {
      sceneManager.startLayer = 9999;

      expect(sceneManager.startLayer).toBeUndefined();
    });

    test('startLayer accepts a value inside the job', () => {
      sceneManager.startLayer = 1;

      expect(sceneManager.startLayer).toBe(1);
    });

    test('endLayer clamps to the number of layers', () => {
      sceneManager.endLayer = 9999;

      expect(sceneManager.endLayer).toBe(sceneManager.job.countLayers);
    });

    test('endLayer clears when unset', () => {
      sceneManager.endLayer = undefined;

      expect(sceneManager.endLayer).toBeUndefined();
    });

    test('updates the clipping planes when the range moves', () => {
      const spy = vi.spyOn(objectsManager(sceneManager), 'updateClippingPlanes');

      sceneManager.endLayer = 1;

      expect(spy).toHaveBeenCalled();
    });

    test('singleLayerMode collapses the range onto the end layer', () => {
      sceneManager.endLayer = 2;

      sceneManager.singleLayerMode = true;

      expect(sceneManager.singleLayerMode).toBe(true);
      expect(sceneManager.startLayer).toBe(1);
    });

    test('singleLayerMode restores the previous start layer when turned off', () => {
      sceneManager.startLayer = 1;
      sceneManager.endLayer = 2;
      sceneManager.singleLayerMode = true;

      sceneManager.singleLayerMode = false;

      expect(sceneManager.startLayer).toBe(1);
    });

    test('singleLayerMode ignores a repeated value', () => {
      const spy = vi.spyOn(objectsManager(sceneManager), 'updateClippingPlanes');

      sceneManager.singleLayerMode = false;

      expect(spy).not.toHaveBeenCalled();
    });

    test('endLayer follows the end layer while single layer mode is on', () => {
      sceneManager.singleLayerMode = true;

      sceneManager.endLayer = 2;

      expect(sceneManager.startLayer).toBe(1);
    });
  });

  describe('buildVolume', () => {
    test('replaces the build volume', () => {
      sceneManager.buildVolume = { x: 100, y: 100, z: 100, smallGrid: true };

      expect(sceneManager.buildVolume?.x).toBe(100);
    });

    test('clears the build volume', () => {
      sceneManager.buildVolume = undefined;

      expect(sceneManager.buildVolume).toBeUndefined();
    });

    test('render works without a build volume', () => {
      sceneManager.buildVolume = undefined;

      expect(() => sceneManager.render()).not.toThrow();
      expect(extrusionGroup(sceneManager).children.length).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    test('swaps in a fresh objects manager carrying the dimensions over', () => {
      sceneManager.lineWidth = 3;
      const previous = objectsManager(sceneManager);

      sceneManager.clear();

      const current = objectsManager(sceneManager);
      expect(current).not.toBe(previous);
      expect(current.lineWidth).toBe(3);
    });

    test('drops the old manager so dispose does not revisit it', () => {
      const previous = objectsManager(sceneManager);
      const spy = vi.spyOn(previous, 'dispose');

      sceneManager.clear();
      sceneManager.dispose();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('removes the bounding box', () => {
      sceneManager.boundingBoxColor = '#00ff00';

      sceneManager.clear();

      expect(sceneManager.boundingBoxMesh).toBeUndefined();
    });

    test('leaves the scene alone when a toggle fires after clearing', () => {
      sceneManager.clear();

      expect(() => {
        sceneManager.renderTravel = true;
        sceneManager.boundingBoxColor = '#00ff00';
      }).not.toThrow();
      expect(travelGroup(sceneManager).children.length).toBe(0);
    });
  });

  describe('rebuild wiring', () => {
    test('a dimension change redraws the scene once the debounce elapses', () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(sceneManager, 'render');

      sceneManager.lineWidth = 5;
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('the redrawn scene contains the extrusions again', () => {
      vi.useFakeTimers();

      sceneManager.lineWidth = 5;
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(extrusionGroup(sceneManager).children.length).toBeGreaterThan(0);
    });

    test('a rebuild request after clear does not redraw the dropped job', () => {
      vi.useFakeTimers();
      sceneManager.clear();
      const spy = vi.spyOn(sceneManager, 'render');

      sceneManager.lineWidth = 5;
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('disableGradient', () => {
    test('round-trips', () => {
      sceneManager.disableGradient = true;

      expect(sceneManager.disableGradient).toBe(true);
    });
  });

  describe('dispose', () => {
    test('empties the disposables', () => {
      sceneManager.dispose();

      expect(sceneManager.renderer.dispose).toHaveBeenCalled();
    });
  });

  describe('progressive rendering', () => {
    test('renders every path across frames', async () => {
      sceneManager.clear();
      const fresh = createSceneManager();

      await fresh.renderAnimated(1);

      expect(extrusionGroup(fresh).children.length).toBeGreaterThan(0);
      fresh.dispose();
    });

    test('falls back to a single pass when a frame covers the whole job', async () => {
      const fresh = createSceneManager();

      await fresh.renderAnimated(0);

      expect(extrusionGroup(fresh).children.length).toBeGreaterThan(0);
      fresh.dispose();
    });

    test('renders in one pass when the job is a single path', async () => {
      const job = new Job();
      appendPath(job, PathType.Extrusion, [
        [0, 0, 0],
        [10, 0, 0]
      ]);
      const fresh = createSceneManager({ job });

      // no default pathCount, so it is derived from the job length
      await fresh.renderAnimated();

      expect(extrusionGroup(fresh).children.length).toBeGreaterThan(0);
      fresh.dispose();
    });

    test('resolves once every path has been drawn', async () => {
      const fresh = createSceneManager();
      let settled = false;

      await fresh.renderAnimated(1).then(() => {
        settled = true;
      });

      expect(settled).toBe(true);
      fresh.dispose();
    });

    test('reports each rendered frame through onFrameRendered', () => {
      const onFrameRendered = vi.fn();
      sceneManager.onFrameRendered = onFrameRendered;

      sceneManager.animate();

      expect(onFrameRendered).toHaveBeenCalled();
    });
  });

  describe('camera persistence', () => {
    afterEach(() => localStorage.clear());

    test('saveCamera writes the camera to localStorage', () => {
      sceneManager.saveCamera();

      expect(JSON.parse(localStorage.getItem('cameraZoom'))).toBe(sceneManager.camera.zoom);
      expect(localStorage.getItem('cameraPosition')).not.toBeNull();
    });

    test('loadCamera restores a saved camera', () => {
      sceneManager.camera.position.set(1, 2, 3);
      sceneManager.camera.zoom = 2;
      sceneManager.saveCamera();
      sceneManager.camera.position.set(0, 0, 0);

      sceneManager.loadCamera();

      expect(sceneManager.camera.position.x).toBe(1);
      expect(sceneManager.camera.zoom).toBe(2);
    });

    test('loadCamera does nothing when nothing was saved', () => {
      localStorage.clear();
      sceneManager.camera.position.set(7, 8, 9);

      sceneManager.loadCamera();

      expect(sceneManager.camera.position.x).toBe(7);
    });

    test('clearCamera removes the saved camera', () => {
      sceneManager.saveCamera();

      sceneManager.clearCamera();

      expect(localStorage.getItem('cameraPosition')).toBeNull();
      expect(localStorage.getItem('cameraTarget')).toBeNull();
    });
  });

  describe('construction', () => {
    test('throws without a canvas', () => {
      expect(() => new SceneManager({ buildVolume: { x: 1, y: 1, z: 1, smallGrid: true } }, createJob())).toThrow(
        'Set either opts.canvas or opts.targetId'
      );
    });

    test('throws without a build volume while centering the controls', () => {
      // Current behavior: the constructor dereferences this._buildVolume
      // unconditionally when aiming the controls, so a missing buildVolume
      // option fails construction. If this starts passing, the constructor
      // learned to handle it and this test should assert the new behavior.
      const canvas = document.createElement('canvas');
      expect(() => new SceneManager({ canvas }, createJob())).toThrow(TypeError);
    });

    test('applies every optional setting', () => {
      const configured = createSceneManager({
        backgroundColor: '#101010',
        boundingBoxColor: '#202020',
        extrusionColor: '#303030',
        travelColor: '#404040',
        topLayerColor: '#505050',
        lastSegmentColor: '#606060',
        toolColors: { 0: '#707070' },
        disableGradient: true,
        renderTubes: true,
        renderTravel: true,
        initialCameraPosition: [1, 2, 3],
        lineWidth: 2,
        lineHeight: 0.3,
        extrusionWidth: 0.8,
        startLayer: 1,
        endLayer: 2
      });

      expect(configured.backgroundColor).toEqual(new Color('#101010'));
      expect(configured.boundingBoxColor).toEqual(new Color('#202020'));
      expect(configured.extrusionColor).toEqual(new Color('#303030'));
      expect(configured.travelColor).toEqual(new Color('#404040'));
      expect(configured.topLayerColor).toEqual(new Color('#505050'));
      expect(configured.lastSegmentColor).toEqual(new Color('#606060'));
      expect(configured.disableGradient).toBe(true);
      expect(configured.renderTubes).toBe(true);
      expect(configured.renderTravel).toBe(true);
      expect(configured.lineWidth).toBe(2);
      expect(configured.lineHeight).toBe(0.3);
      expect(configured.extrusionWidth).toBe(0.8);

      configured.dispose();
    });
  });
});

/** Reaches the private ObjectsManager the SceneManager delegates to. */
function objectsManager(sceneManager: SceneManager): ObjectsManager {
  return (sceneManager as unknown as { objectsManager: ObjectsManager }).objectsManager;
}

function extrusionGroup(sceneManager: SceneManager): Group {
  return sceneManager.scene.children.find((child) => child.name === 'Extrusions') as Group;
}

function travelGroup(sceneManager: SceneManager): Group {
  return sceneManager.scene.children.find((child) => child.name === 'Travel Moves') as Group;
}

function createSceneManager(opts: Partial<SceneManagerOptions> & { job?: Job } = {}): SceneManager {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'offsetWidth', { value: 800 });
  Object.defineProperty(canvas, 'offsetHeight', { value: 600 });

  const { job, ...sceneOptions } = opts;

  return new SceneManager(
    {
      canvas,
      buildVolume: { x: 200, y: 200, z: 200, smallGrid: true },
      renderExtrusion: true,
      renderTravel: false,
      ...sceneOptions
    },
    job ?? createJob()
  );
}

/** A two layer job with an extrusion and a travel move on each layer. */
function createJob(): Job {
  const job = new Job();

  [0, 0.2].forEach((z) => {
    appendPath(job, PathType.Extrusion, [
      [0, 0, z],
      [10, 0, z],
      [10, 10, z]
    ]);
    appendPath(job, PathType.Travel, [
      [10, 10, z],
      [0, 0, z]
    ]);
    // the bounding box is normally filled in by the interpreter, not by addPath
    job.boundingBox.update(0, 0, z);
    job.boundingBox.update(10, 10, z);
  });

  return job;
}

function appendPath(job: Job, type: PathType, points: [number, number, number][]): void {
  const path = new Path(type, 0.6, 0.2, 0);
  points.forEach((point) => path.addPoint(...point));
  job.addPath(path);
}

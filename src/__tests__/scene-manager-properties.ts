import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';

// WebGL and OrbitControls cannot run under happy-dom, so only those two are stubbed.
// Everything else — the scene graph, materials, the ObjectsManager — is real.
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  // the orthographic swap clones and copies the target, so it needs to behave
  // like a Vector3 rather than a bag of spies
  class Vec3 {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0
    ) {}
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v: { x: number; y: number; z: number }) {
      return this.set(v.x, v.y, v.z);
    }
    clone() {
      return new Vec3(this.x, this.y, this.z);
    }
    toArray() {
      return [this.x, this.y, this.z];
    }
  }

  return {
    OrbitControls: class {
      target = new Vec3();
      screenSpacePanning = false;
      update = vi.fn();
      dispose = vi.fn();
    }
  };
});

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
import { Color, Group, OrthographicCamera, PerspectiveCamera } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

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

      sceneManager.renderExtrusion = false;
      sceneManager.renderExtrusion = true;

      const [tool0] = extrusionGroup(sceneManager).children as LineSegments2[];
      expect((tool0.material as LineMaterial).color.getHex()).toBe(0xff0000);
    });

    test('a tool without a configured color falls back to the last one, warning once', () => {
      // a tool index one past the colors supplied used to read extrusionColor[2]
      // as undefined and poison the material color downstream
      const job = createJob();
      const highToolPath = new Path(PathType.Extrusion, 0.6, 0.2, 2);
      highToolPath.addPoint(0, 0, 0);
      highToolPath.addPoint(5, 0, 0);
      job.addPath(highToolPath);

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fresh = createSceneManager({ job, renderTubes: true, extrusionColor: ['#00ff00'] });

      expect(() => fresh.render()).not.toThrow();

      expect(objectsManager(fresh).materials[2].uniforms.uColor.value.getHex()).toBe(0x00ff00);
      expect(warn).toHaveBeenCalledWith('No extrusionColor configured for tool index 2, falling back to another color');

      fresh.render();
      expect(warn).toHaveBeenCalledTimes(1);

      fresh.dispose();
    });

    test('a shorter color array repaints the extra tools with the fallback', () => {
      const job = createJob();
      const highToolPath = new Path(PathType.Extrusion, 0.6, 0.2, 2);
      highToolPath.addPoint(0, 0, 0);
      highToolPath.addPoint(5, 0, 0);
      job.addPath(highToolPath);

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fresh = createSceneManager({ job, renderTubes: true, extrusionColor: ['#ff0000', '#00ff00', '#0000ff'] });

      fresh.extrusionColor = ['#112233'];

      const materials = objectsManager(fresh).materials;
      expect(materials[0].uniforms.uColor.value.getHex()).toBe(0x112233);
      expect(materials[2].uniforms.uColor.value.getHex()).toBe(0x112233);

      fresh.dispose();
      warn.mockRestore();
    });

    test('an array extrusionColor is safe to set after clear drops the job', () => {
      sceneManager.clear();

      expect(() => {
        sceneManager.extrusionColor = ['#ff0000'];
      }).not.toThrow();
    });

    test('falls back to the default extrusion color when the color array is empty', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fresh = createSceneManager({ job: createJob(), renderTubes: true, extrusionColor: [] });

      expect(() => fresh.render()).not.toThrow();

      expect(objectsManager(fresh).materials[0].uniforms.uColor.value.getHex()).toBe(
        SceneManager.defaultExtrusionColor.getHex()
      );

      fresh.dispose();
      warn.mockRestore();
    });

    test('extrusionColor accepts an array, one entry per tool', () => {
      const spy = vi.spyOn(objectsManager(sceneManager), 'setExtrusionColor');

      sceneManager.extrusionColor = ['#ff0000', '#0000ff'];

      expect(spy).toHaveBeenCalledWith([new Color('#ff0000'), new Color('#0000ff')]);
      expect(sceneManager.extrusionColor).toEqual([new Color('#ff0000'), new Color('#0000ff')]);
    });

    test('travelColor recolors the travel lines', () => {
      sceneManager.renderTravel = true;

      sceneManager.travelColor = '#ff00ff';

      const travel = travelGroup(sceneManager).children[0] as LineSegments2;
      expect((travel.material as LineMaterial).color.getHex()).toBe(0xff00ff);
      expect(sceneManager.travelColor).toEqual(new Color('#ff00ff'));
    });

    test('travel lines set before drawing get the stored color when they draw', () => {
      sceneManager.travelColor = '#ff00ff';

      sceneManager.renderTravel = true;

      const travel = travelGroup(sceneManager).children[0] as LineSegments2;
      expect((travel.material as LineMaterial).color.getHex()).toBe(0xff00ff);
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

    test('an end layer at the top of the stack leaves the range unbounded', () => {
      // the demo drives endLayer to countLayers by default; that is no
      // restriction, so nothing — travel moves above the top layer
      // included — should be clipped (#278)
      sceneManager.endLayer = sceneManager.job.countLayers;

      expect(objectsManager(sceneManager).clippingPlanes).toHaveLength(0);
    });

    test('a start layer at the bottom of the stack adds no lower bound', () => {
      sceneManager.startLayer = 1;

      expect(objectsManager(sceneManager).clippingPlanes).toHaveLength(0);
    });

    test('a start layer above the first still bounds the bottom of the range', () => {
      sceneManager.startLayer = 2;

      const planes = objectsManager(sceneManager).clippingPlanes;
      const layer = sceneManager.job.layers[1];
      expect(planes).toHaveLength(1);
      expect(planes[0].constant).toBe(-(layer.z - layer.height));
    });

    test('travel lines above the top layer survive a full-stack range', () => {
      sceneManager.renderTravel = true;

      sceneManager.endLayer = sceneManager.job.countLayers;

      const travel = travelGroup(sceneManager).children[0] as LineSegments2;
      expect((travel.material as LineMaterial).clippingPlanes).toHaveLength(0);
    });

    test('a restricted range still clips the travel lines', () => {
      sceneManager.renderTravel = true;

      sceneManager.endLayer = 1;

      const travel = travelGroup(sceneManager).children[0] as LineSegments2;
      expect((travel.material as LineMaterial).clippingPlanes).toHaveLength(1);
    });

    test('an end-layer-only range leaves the lower bound open instead of NaN', () => {
      sceneManager.endLayer = 1;

      const planes = objectsManager(sceneManager).clippingPlanes;
      expect(planes).toHaveLength(1);
      expect(planes[0].constant).toBe(sceneManager.job.layers[0].z);
    });

    test('tube materials keep an open lower bound when only endLayer is set', () => {
      const fresh = createSceneManager({ renderTubes: true });

      fresh.endLayer = 1;

      const materials = objectsManager(fresh).materials;
      expect(materials.length).toBeGreaterThan(0);
      materials.forEach((material) => {
        expect(material.uniforms.clipMinY.value).toBe(-Infinity);
        expect(Number.isNaN(material.uniforms.clipMaxY.value)).toBe(false);
      });

      fresh.dispose();
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

    test('keeps the build volume and bounding box color for the next job', () => {
      sceneManager.boundingBoxColor = '#00ff00';

      sceneManager.clear();

      expect(sceneManager.buildVolume?.x).toBe(200);
      expect(sceneManager.buildVolume?.smallGrid).toBe(true);
      expect((sceneManager.boundingBoxColor as Color).getHex()).toBe(0x00ff00);
      // the box itself belonged to the cleared job
      expect(sceneManager.boundingBoxMesh).toBeUndefined();
    });

    test('does not resurrect a build volume that was removed', () => {
      sceneManager.buildVolume = undefined;

      sceneManager.clear();

      expect(sceneManager.buildVolume).toBeUndefined();
    });

    test('keeps the extrusion and travel colors for the next job', () => {
      sceneManager.extrusionColor = '#123456';
      sceneManager.travelColor = '#654321';

      sceneManager.clear();

      expect((sceneManager.extrusionColor as Color).getHex()).toBe(0x123456);
      expect(sceneManager.travelColor.getHex()).toBe(0x654321);
    });

    test('a missing tool color warns again for the next job', () => {
      // the warn-once bookkeeping belongs to the swapped manager, so a newly
      // loaded job — which may have different tools — gets its own warning
      const job = createJob();
      const highToolPath = new Path(PathType.Extrusion, 0.6, 0.2, 2);
      highToolPath.addPoint(0, 0, 0);
      highToolPath.addPoint(5, 0, 0);
      job.addPath(highToolPath);

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fresh = createSceneManager({ job, extrusionColor: ['#00ff00'] });
      fresh.render();
      expect(warn).toHaveBeenCalledTimes(1);

      fresh.clear();
      fresh.job = job;
      fresh.render();

      expect(warn).toHaveBeenCalledTimes(2);

      fresh.dispose();
      warn.mockRestore();
    });

    test('keeps renderTubes and the lighting for the next job', () => {
      sceneManager.renderTubes = true;
      sceneManager.ambientLight = 0.7;
      sceneManager.directionalLight = 0.9;
      sceneManager.brightness = 1.1;

      sceneManager.clear();

      expect(sceneManager.renderTubes).toBe(true);
      expect(sceneManager.ambientLight).toBe(0.7);
      expect(sceneManager.directionalLight).toBe(0.9);
      expect(sceneManager.brightness).toBe(1.1);
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

  describe('orthographic camera', () => {
    test('starts perspective', () => {
      expect(sceneManager.orthographic).toBe(false);
      expect(sceneManager.camera).toBeInstanceOf(PerspectiveCamera);
    });

    test('swaps the camera when enabled', () => {
      sceneManager.orthographic = true;

      expect(sceneManager.orthographic).toBe(true);
      expect(sceneManager.camera).toBeInstanceOf(OrthographicCamera);
    });

    test('swaps back when disabled', () => {
      sceneManager.orthographic = true;
      sceneManager.orthographic = false;

      expect(sceneManager.camera).toBeInstanceOf(PerspectiveCamera);
    });

    test('carries the camera position and target across the swap', () => {
      sceneManager.camera.position.set(11, 22, 33);
      sceneManager.controls.target.set(1, 2, 3);

      sceneManager.orthographic = true;

      expect(sceneManager.camera.position.toArray()).toEqual([11, 22, 33]);
      expect(sceneManager.controls.target.toArray()).toEqual([1, 2, 3]);
    });

    test('enables screen space panning in orthographic mode', () => {
      sceneManager.orthographic = true;

      expect(sceneManager.controls.screenSpacePanning).toBe(true);
    });

    test('ignores a repeated value', () => {
      sceneManager.orthographic = true;
      const camera = sceneManager.camera;

      sceneManager.orthographic = true;

      expect(sceneManager.camera).toBe(camera);
    });

    test('sizes the frustum from the job bounds', () => {
      sceneManager.orthographic = true;

      // the test job spans 10mm, so the frustum is padded around that
      const camera = sceneManager.camera as OrthographicCamera;
      expect(camera.top).toBeGreaterThan(0);
      expect(camera.left).toBeLessThan(0);
    });

    test('falls back to the build volume when the job has no bounds', () => {
      const job = new Job();
      appendPath(job, PathType.Extrusion, [
        [0, 0, 0],
        [10, 0, 0]
      ]);
      const unbounded = createSceneManager({ job });

      unbounded.orthographic = true;

      const camera = unbounded.camera as OrthographicCamera;
      // build volume is 200mm, much larger than the job
      expect(camera.top).toBeGreaterThan(50);
      unbounded.dispose();
    });

    test('falls back to a default size with neither bounds nor build volume', () => {
      const job = new Job();
      appendPath(job, PathType.Extrusion, [
        [0, 0, 0],
        [10, 0, 0]
      ]);
      const bare = createSceneManager({ job });
      bare.buildVolume = undefined;

      bare.orthographic = true;

      expect(bare.camera).toBeInstanceOf(OrthographicCamera);
      bare.dispose();
    });

    test('resize keeps the orthographic frustum square to the canvas', () => {
      sceneManager.orthographic = true;
      const camera = sceneManager.camera as OrthographicCamera;
      const widthBefore = camera.right - camera.left;

      sceneManager.resize();

      expect(camera.right - camera.left).toBeCloseTo(widthBefore, 5);
      expect(camera.right).toBeGreaterThan(camera.top);
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

    test('draws every path, including the last one', async () => {
      // the loop's end bound used to stop one short of the combined list, so
      // the job's final path — a travel move in this job — never appeared
      const fresh = createSceneManager({ renderTravel: true });

      await fresh.renderAnimated(1);

      const segments = (travelGroup(fresh).children as LineSegments2[]).reduce(
        (total, line) => total + positionCountOf(line) / 6,
        0
      );
      expect(segments).toBe(2); // one travel move per layer of the two-layer job
      fresh.dispose();
    });

    test('the categories keep their own pace, so travels are not exhausted early', async () => {
      // renderPathIndex used to index the combined list but slice the travels
      // array with it, drawing travels far ahead of the extrusions
      const fresh = createSceneManager({ renderTravel: true });
      const spy = vi.spyOn(objectsManager(fresh), 'renderPaths');

      await fresh.renderAnimated(1);

      // every frame hands over a prefix of the combined list; the manager
      // routes by category, so no frame slices travels with an alien index
      const firstFramePaths = spy.mock.calls[0][0];
      expect(firstFramePaths).toHaveLength(1);
      expect(firstFramePaths[0]).toBe(fresh.job.paths[0]);
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

/** Number of floats in a line's packed position buffer; six per segment. */
function positionCountOf(lines: LineSegments2): number {
  return (lines.geometry.attributes.instanceStart.data.array as Float32Array).length;
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

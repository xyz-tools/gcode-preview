import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { ObjectsManager } from '../objects-manager';
import { Path, PathType } from '../path';
import { BoundingBox } from '../bounding-box';
import { Scene, Color, Group, BatchedMesh, LineBasicMaterial } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

describe('ObjectsManager', () => {
  let scene: Scene;
  let objectsManager: ObjectsManager;

  beforeEach(() => {
    scene = new Scene();
    objectsManager = new ObjectsManager(scene, 0.4, 0.2, 0.6);
  });

  describe('constructor', () => {
    test('creates extrusions and travel moves groups', () => {
      expect(objectsManager.extrusionsGroup).toBeInstanceOf(Group);
      expect(objectsManager.travelMovesGroup).toBeInstanceOf(Group);
    });

    test('adds groups to scene', () => {
      expect(scene.children).toContain(objectsManager.extrusionsGroup);
      expect(scene.children).toContain(objectsManager.travelMovesGroup);
    });

    test('names the groups correctly', () => {
      expect(objectsManager.extrusionsGroup.name).toBe('Extrusions');
      expect(objectsManager.travelMovesGroup.name).toBe('Travel Moves');
    });

    test('sets line width and height', () => {
      expect(objectsManager.lineWidth).toBe(0.4);
      expect(objectsManager.lineHeight).toBe(0.2);
    });

    test('sets extrusion width', () => {
      expect(objectsManager.extrusionWidth).toBe(0.6);
    });

    test('starts with no clipping planes until a layer range is set', () => {
      expect(objectsManager.clippingPlanes.length).toBe(0);
    });
  });

  describe('visibility controls', () => {
    describe('setTravelsVisible', () => {
      test('hides the travel moves group', () => {
        objectsManager.setTravelsVisible(true);
        objectsManager.setTravelsVisible(false);

        expect(objectsManager.travelMovesGroup.visible).toBe(false);
      });

      test('shows the travel moves group', () => {
        objectsManager.setTravelsVisible(false);
        objectsManager.setTravelsVisible(true);

        expect(objectsManager.travelMovesGroup.visible).toBe(true);
      });

      test('leaves the geometry in place when hiding', () => {
        objectsManager.renderTravelLines([createTestPath()], new Color(0xff0000));

        objectsManager.setTravelsVisible(false);

        expect(objectsManager.travelMovesGroup.children.length).toBe(1);
      });
    });

    describe('setExtrusionsVisible', () => {
      test('hides the extrusions group', () => {
        objectsManager.setExtrusionsVisible(true);
        objectsManager.setExtrusionsVisible(false);

        expect(objectsManager.extrusionsGroup.visible).toBe(false);
      });

      test('shows the extrusions group', () => {
        objectsManager.setExtrusionsVisible(false);
        objectsManager.setExtrusionsVisible(true);

        expect(objectsManager.extrusionsGroup.visible).toBe(true);
      });
    });
  });

  describe('renderTravelLines', () => {
    test('adds rendered paths to travelMovesGroup', () => {
      const path = createTestPath();
      const color = new Color(0xff0000);

      objectsManager.renderTravelLines([path], color);

      expect(objectsManager.travelMovesGroup.children.length).toBe(1);
    });

    test('does not re-render already rendered paths', () => {
      const path = createTestPath();
      const color = new Color(0xff0000);

      objectsManager.renderTravelLines([path], color);
      objectsManager.renderTravelLines([path], color);

      expect(objectsManager.travelMovesGroup.children.length).toBe(1);
    });

    test('renders only unrendered paths from a mixed array', () => {
      const path1 = createTestPath();
      const path2 = createTestPath();
      const color = new Color(0xff0000);

      objectsManager.renderTravelLines([path1], color);
      const initialChildren = objectsManager.travelMovesGroup.children.length;

      objectsManager.renderTravelLines([path1, path2], color);

      expect(objectsManager.travelMovesGroup.children.length).toBe(initialChildren + 1);
    });
  });

  describe('renderExtrusionLines', () => {
    test('adds rendered paths to extrusionsGroup', () => {
      const path = createTestPath();
      const color = new Color(0x00ff00);

      objectsManager.renderExtrusionLines([path], color);

      expect(objectsManager.extrusionsGroup.children.length).toBe(1);
    });

    test('does not re-render already rendered paths', () => {
      const path = createTestPath();
      const color = new Color(0x00ff00);

      objectsManager.renderExtrusionLines([path], color);
      objectsManager.renderExtrusionLines([path], color);

      expect(objectsManager.extrusionsGroup.children.length).toBe(1);
    });

    describe('vertex packing', () => {
      test('emits one segment per pair of consecutive points', () => {
        // 3 points -> 2 segments -> 12 floats
        objectsManager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));

        expect(positionsOf(objectsManager.extrusionsGroup.children[0] as LineSegments2)).toHaveLength(12);
      });

      test('packs several paths back to back', () => {
        objectsManager.renderExtrusionLines([createTestPath(), createTestPath()], new Color(0x00ff00));

        expect(positionsOf(objectsManager.extrusionsGroup.children[0] as LineSegments2)).toHaveLength(24);
      });

      test('offsets each point below the nozzle height', () => {
        const manager = new ObjectsManager(new Scene(), 0.4, 0.2);
        const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);
        path.addPoint(1, 2, 3);
        path.addPoint(4, 5, 6);

        manager.renderExtrusionLines([path], new Color(0x00ff00));

        // y drops by 0.1, z drops by half the line height
        const positions = positionsOf(manager.extrusionsGroup.children[0] as LineSegments2);
        expect(positions).toEqual(new Float32Array([1, 1.9, 2.9, 4, 4.9, 5.9]));
      });

      test('produces an empty buffer for a path too short to make a segment', () => {
        const tooShort = new Path(PathType.Extrusion, 0.6, 0.2, 0);
        tooShort.addPoint(0, 0, 0);

        objectsManager.renderExtrusionLines([tooShort], new Color(0x00ff00));

        expect(positionsOf(objectsManager.extrusionsGroup.children[0] as LineSegments2)).toHaveLength(0);
      });

      test('hands three.js a Float32Array so it does not have to convert one', () => {
        objectsManager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));

        expect(positionsOf(objectsManager.extrusionsGroup.children[0] as LineSegments2)).toBeInstanceOf(Float32Array);
      });
    });
  });

  describe('renderExtrusionTubes', () => {
    test('adds rendered paths to extrusionsGroup', () => {
      const path = createTestPath();
      const color = new Color(0x0000ff);

      objectsManager.renderExtrusionTubes([path], color);

      expect(objectsManager.extrusionsGroup.children.length).toBe(1);
    });

    test('does not re-render already rendered paths', () => {
      const path = createTestPath();
      const color = new Color(0x0000ff);

      objectsManager.renderExtrusionTubes([path], color);
      objectsManager.renderExtrusionTubes([path], color);

      expect(objectsManager.extrusionsGroup.children.length).toBe(1);
    });

    test('skips paths too short to produce geometry', () => {
      const tooShort = new Path(PathType.Extrusion, 0.6, 0.2, 0);
      tooShort.addPoint(0, 0, 0);

      objectsManager.renderExtrusionTubes([tooShort], new Color(0x0000ff));
      const empty = objectsManager.extrusionsGroup.children[0] as BatchedMesh;

      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));
      const populated = objectsManager.extrusionsGroup.children[1] as BatchedMesh;

      expect(empty.geometry?.attributes?.position).toBeUndefined();
      expect(populated.geometry.attributes.position.count).toBeGreaterThan(0);
    });

    test('adds material to materials array', () => {
      const path = createTestPath();
      const color = new Color(0x0000ff);

      const initialMaterialCount = objectsManager.materials.length;
      objectsManager.renderExtrusionTubes([path], color);

      expect(objectsManager.materials.length).toBe(initialMaterialCount + 1);
    });

    test('tools sharing a color get their own materials, so recoloring one leaves the other alone', () => {
      const color = new Color(0x0000ff);
      objectsManager.renderExtrusionTubes([createTestPath()], color, 0);
      objectsManager.renderExtrusionTubes([createTestPath()], color, 1);

      expect(objectsManager.materials[0]).not.toBe(objectsManager.materials[1]);

      objectsManager.setExtrusionColor([new Color(0x00ff00), color]);

      expect(objectsManager.materials[0].uniforms.uColor.value.getHex()).toBe(0x00ff00);
      expect(objectsManager.materials[1].uniforms.uColor.value.getHex()).toBe(0x0000ff);
    });

    test('a fresh manager does not resurrect materials from a disposed one', () => {
      const first = new ObjectsManager(new Scene(), 0.4, 0.2, 0.6);
      first.renderExtrusionTubes([createTestPath()], new Color(0x123456));
      const firstMaterial = first.materials[0];
      first.dispose();

      const second = new ObjectsManager(new Scene(), 0.4, 0.2, 0.6);
      second.renderExtrusionTubes([createTestPath()], new Color(0x123456));

      expect(second.materials[0]).not.toBe(firstMaterial);
      second.dispose();
    });
  });

  describe('dispose', () => {
    test('removes extrusionsGroup from parent', () => {
      objectsManager.dispose();

      expect(scene.children).not.toContain(objectsManager.extrusionsGroup);
    });

    test('removes travelMovesGroup from parent', () => {
      objectsManager.dispose();

      expect(scene.children).not.toContain(objectsManager.travelMovesGroup);
    });

    test('disposes all disposables', () => {
      const mockDisposable = { dispose: vi.fn() };
      objectsManager.disposables.push(mockDisposable);

      objectsManager.dispose();

      expect(mockDisposable.dispose).toHaveBeenCalledTimes(1);
    });

    test('clears disposables array after dispose', () => {
      const mockDisposable = { dispose: vi.fn() };
      objectsManager.disposables.push(mockDisposable);

      objectsManager.dispose();

      expect(objectsManager.disposables.length).toBe(0);
    });
  });

  describe('reset', () => {
    test('empties both groups', () => {
      objectsManager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));
      objectsManager.renderTravelLines([createTestPath()], new Color(0xff0000));

      objectsManager.reset();

      expect(objectsManager.extrusionsGroup.children.length).toBe(0);
      expect(objectsManager.travelMovesGroup.children.length).toBe(0);
    });

    test('allows the same paths to be rendered again', () => {
      const path = createTestPath();
      const color = new Color(0x00ff00);
      objectsManager.renderExtrusionLines([path], color);

      objectsManager.reset();
      objectsManager.renderExtrusionLines([path], color);

      expect(objectsManager.extrusionsGroup.children.length).toBe(1);
    });

    test('disposes geometries and materials it is discarding', () => {
      const mockDisposable = { dispose: vi.fn() };
      objectsManager.disposables.push(mockDisposable);

      objectsManager.reset();

      expect(mockDisposable.dispose).toHaveBeenCalledTimes(1);
      expect(objectsManager.disposables.length).toBe(0);
    });

    test('clears the shader materials', () => {
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      objectsManager.reset();

      expect(objectsManager.materials.length).toBe(0);
    });
  });

  describe('updateClippingPlanes', () => {
    test('updates shader materials with min and max Z values', () => {
      const path = createTestPath();
      const color = new Color(0x0000ff);
      objectsManager.renderExtrusionTubes([path], color);

      objectsManager.updateClippingPlanes(1.0, 10.0);

      objectsManager.materials.forEach((material) => {
        expect(material.uniforms.clipMinY.value).toBe(1.0);
        expect(material.uniforms.clipMaxY.value).toBe(10.0);
      });
    });

    test('an open-ended range resets tube uniforms to infinities', () => {
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));
      objectsManager.updateClippingPlanes(1.0, 10.0);

      objectsManager.updateClippingPlanes();

      objectsManager.materials.forEach((material) => {
        expect(material.uniforms.clipMinY.value).toBe(-Infinity);
        expect(material.uniforms.clipMaxY.value).toBe(Infinity);
      });
      expect(objectsManager.clippingPlanes).toHaveLength(0);
    });

    test('stores the planes for the current layer range', () => {
      objectsManager.updateClippingPlanes(1.0, 10.0);

      expect(objectsManager.clippingPlanes.length).toBe(2);
    });

    test('applies the current planes to lines rendered afterwards', () => {
      objectsManager.updateClippingPlanes(1.0, 10.0);

      objectsManager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));

      const line = objectsManager.extrusionsGroup.children[0] as LineSegments2;
      expect((line.material as LineMaterial).clippingPlanes).toEqual(objectsManager.clippingPlanes);
    });

    test('re-clips lines that were already in the scene', () => {
      objectsManager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));
      objectsManager.renderTravelLines([createTestPath()], new Color(0xff0000));

      objectsManager.updateClippingPlanes(2.0, 20.0);

      const extrusion = objectsManager.extrusionsGroup.children[0] as LineSegments2;
      const travel = objectsManager.travelMovesGroup.children[0] as LineSegments2;
      expect((extrusion.material as LineMaterial).clippingPlanes).toBe(objectsManager.clippingPlanes);
      expect((travel.material as LineMaterial).clippingPlanes).toBe(objectsManager.clippingPlanes);
    });

    test('applies the current range to tube materials created afterwards', () => {
      objectsManager.updateClippingPlanes(1.0, 10.0);

      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      const [material] = objectsManager.materials;
      expect(material.uniforms.clipMinY.value).toBe(1.0);
      expect(material.uniforms.clipMaxY.value).toBe(10.0);
    });

    test('keeps the layer range across a rebuild', () => {
      objectsManager.updateClippingPlanes(1.0, 10.0);
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      // a rebuild throws the materials away and makes new ones
      objectsManager.reset();
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      const [material] = objectsManager.materials;
      expect(material.uniforms.clipMinY.value).toBe(1.0);
      expect(material.uniforms.clipMaxY.value).toBe(10.0);
    });
  });

  describe('renderExtrusions', () => {
    test('renders lines when renderTubes is off', () => {
      objectsManager.renderExtrusions([createTestPath()]);

      expect(objectsManager.extrusionsGroup.children[0]).toBeInstanceOf(LineSegments2);
    });

    test('renders tubes when renderTubes is on', () => {
      objectsManager.renderTubes = true;

      objectsManager.renderExtrusions([createTestPath()]);

      expect(objectsManager.extrusionsGroup.children[0]).toBeInstanceOf(BatchedMesh);
    });

    test('draws each tool in the color its array entry resolves to', () => {
      objectsManager.setExtrusionColor([new Color(0xff0000), new Color(0x0000ff)]);

      objectsManager.renderExtrusions([createTestPath()], 0);
      objectsManager.renderExtrusions([createTestPath()], 1);

      const [tool0, tool1] = objectsManager.extrusionsGroup.children as LineSegments2[];
      expect((tool0.material as LineMaterial).color.getHex()).toBe(0xff0000);
      expect((tool1.material as LineMaterial).color.getHex()).toBe(0x0000ff);
    });

    test('draws tubes in the color the tool resolves to', () => {
      objectsManager.renderTubes = true;
      objectsManager.setExtrusionColor([new Color(0xff0000), new Color(0x0000ff)]);

      objectsManager.renderExtrusions([createTestPath()], 1);

      expect(objectsManager.materials[1].uniforms.uColor.value.getHex()).toBe(0x0000ff);
    });
  });

  describe('appearance changes', () => {
    test('setExtrusionColor updates the tube material uniform', () => {
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x000000));
      const color = new Color(0x00ff00);

      objectsManager.setExtrusionColor(color);

      expect(objectsManager.materials[0].uniforms.uColor.value).toBe(color);
    });

    test('an array setExtrusionColor recolors each tool independently', () => {
      const original = new Color(0x000000);
      const updated = new Color(0x00ff00);
      objectsManager.renderExtrusionLines([createTestPath()], original, 0);
      objectsManager.renderExtrusionLines([createTestPath()], original, 1);

      objectsManager.setExtrusionColor([original, updated]);

      const [tool0, tool1] = objectsManager.extrusionsGroup.children as LineSegments2[];
      expect((tool0.material as LineMaterial).color.equals(original)).toBe(true);
      expect((tool1.material as LineMaterial).color.equals(updated)).toBe(true);
    });

    test('setExtrusionColor without a tool index recolors the lines of every tool', () => {
      const original = new Color(0x000000);
      const updated = new Color(0x00ff00);
      objectsManager.renderExtrusionLines([createTestPath()], original, 0);
      objectsManager.renderExtrusionLines([createTestPath()], original, 2);

      objectsManager.setExtrusionColor(updated);

      objectsManager.extrusionsGroup.children.forEach((child) => {
        expect(((child as LineSegments2).material as LineMaterial).color.equals(updated)).toBe(true);
      });
    });

    test('setExtrusionColor without a tool index recolors every tube material', () => {
      objectsManager.renderTubes = true;
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0xff0000), 0);
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff), 1);
      const updated = new Color(0x00ff00);

      objectsManager.setExtrusionColor(updated);

      objectsManager.materials.forEach((material) => {
        expect(material.uniforms.uColor.value).toBe(updated);
      });
    });

    test('setExtrusionColor without a tool index tolerates a material without uniforms', () => {
      objectsManager.renderTubes = true;
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0xff0000), 0);
      objectsManager.materials[1] = {} as (typeof objectsManager.materials)[number];
      const updated = new Color(0x00ff00);

      expect(() => objectsManager.setExtrusionColor(updated)).not.toThrow();

      expect(objectsManager.materials[0].uniforms.uColor.value).toBe(updated);
    });

    test('setTravelColor ignores non-line children in the travel group', () => {
      objectsManager.renderTravelLines([createTestPath()], new Color(0x000000));
      objectsManager.travelMovesGroup.add(new Group());
      const updated = new Color(0x00ff00);

      expect(() => objectsManager.setTravelColor(updated)).not.toThrow();

      const line = objectsManager.travelMovesGroup.children[0] as LineSegments2;
      expect((line.material as LineMaterial).color.equals(updated)).toBe(true);
    });

    test('lighting updates skip materials missing the uniform', () => {
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0xff0000), 0);
      objectsManager.materials[1] = { uniforms: {} } as (typeof objectsManager.materials)[number];

      expect(() => objectsManager.setBrightness(2)).not.toThrow();

      expect(objectsManager.materials[0].uniforms.brightness.value).toBe(2);
    });

    test('a shrunken color array repaints line-drawn tools with the fallback', () => {
      objectsManager.setExtrusionColor([new Color(0xff0000), new Color(0x00ff00), new Color(0x0000ff)]);
      objectsManager.renderExtrusions([createTestPath()], 0);
      objectsManager.renderExtrusions([createTestPath()], 1);
      objectsManager.renderExtrusions([createTestPath()], 2);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      objectsManager.setExtrusionColor([new Color(0x123456)]);

      const lines = objectsManager.extrusionsGroup.children as LineSegments2[];
      lines.forEach((line) => {
        expect((line.material as LineMaterial).color.getHex()).toBe(0x123456);
      });
      warn.mockRestore();
    });

    test('setTravelColor is used as the default when travel lines draw later', () => {
      objectsManager.setTravelColor(new Color(0x654321));

      objectsManager.renderTravelLines([createTestPath()]);

      const travel = objectsManager.travelMovesGroup.children[0] as LineSegments2;
      expect((travel.material as LineMaterial).color.getHex()).toBe(0x654321);
    });

    test('setExtrusionColor reuses the existing geometry', () => {
      objectsManager.renderExtrusionLines([createTestPath()], new Color(0x000000));
      const before = objectsManager.extrusionsGroup.children[0];

      objectsManager.setExtrusionColor(new Color(0x00ff00));

      expect(objectsManager.extrusionsGroup.children[0]).toBe(before);
    });

    test('setTravelColor recolors the travel lines', () => {
      objectsManager.renderTravelLines([createTestPath()], new Color(0x000000));
      const color = new Color(0xff00ff);

      objectsManager.setTravelColor(color);

      const line = objectsManager.travelMovesGroup.children[0] as LineSegments2;
      expect((line.material as LineMaterial).color.equals(color)).toBe(true);
    });

    test('lighting setters update the shader uniforms', () => {
      objectsManager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      objectsManager.setAmbientLight(0.9);
      objectsManager.setDirectionalLight(0.8);
      objectsManager.setBrightness(0.7);

      const [material] = objectsManager.materials;
      expect(material.uniforms.ambient.value).toBe(0.9);
      expect(material.uniforms.directional.value).toBe(0.8);
      expect(material.uniforms.brightness.value).toBe(0.7);
    });
  });

  describe('geometry-invalidating changes', () => {
    let onRebuildNeeded: ReturnType<typeof vi.fn>;
    let manager: ObjectsManager;

    beforeEach(() => {
      vi.useFakeTimers();
      onRebuildNeeded = vi.fn();
      manager = new ObjectsManager(new Scene(), 0.4, 0.2, 0.6, onRebuildNeeded);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test.each([
      ['setLineWidth', () => manager.setLineWidth(2)],
      ['setLineHeight', () => manager.setLineHeight(0.5)],
      ['setExtrusionWidth', () => manager.setExtrusionWidth(1.2)],
      ['setRenderTubes', () => manager.setRenderTubes(true)]
    ])('%s asks for a rebuild', (_name, change) => {
      change();
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(onRebuildNeeded).toHaveBeenCalledTimes(1);
    });

    test('discards the existing geometry before rebuilding', () => {
      manager.renderExtrusionLines([createTestPath()], new Color(0x00ff00));

      manager.setLineWidth(2);
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(manager.extrusionsGroup.children.length).toBe(0);
    });

    test.each([
      ['setLineWidth', () => manager.setLineWidth(0.4)],
      ['setLineHeight', () => manager.setLineHeight(0.2)],
      ['setExtrusionWidth', () => manager.setExtrusionWidth(0.6)],
      ['setRenderTubes', () => manager.setRenderTubes(false)]
    ])('%s does not rebuild when the value is unchanged', (_name, change) => {
      change();
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(onRebuildNeeded).not.toHaveBeenCalled();
    });

    test('coalesces a burst of changes into a single rebuild', () => {
      manager.setLineWidth(1);
      manager.setLineWidth(2);
      manager.setLineWidth(3);
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(onRebuildNeeded).toHaveBeenCalledTimes(1);
    });

    test('appearance and visibility changes never ask for a rebuild', () => {
      manager.renderExtrusionTubes([createTestPath()], new Color(0x0000ff));

      manager.setExtrusionColor(new Color(0x00ff00));
      manager.setTravelColor(new Color(0xff0000));
      manager.setBrightness(0.5);
      manager.setTravelsVisible(false);
      manager.setExtrusionsVisible(false);
      manager.updateClippingPlanes(1, 10);
      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(onRebuildNeeded).not.toHaveBeenCalled();
    });

    test('a pending rebuild does not fire after dispose', () => {
      manager.setLineWidth(2);
      manager.dispose();

      vi.advanceTimersByTime(ObjectsManager.rebuildDebounce);

      expect(onRebuildNeeded).not.toHaveBeenCalled();
    });
  });

  describe('build volume', () => {
    const dimensions = { x: 100, y: 120, z: 50, smallGrid: false };

    test('setBuildVolume adds the visualization to the scene', () => {
      objectsManager.setBuildVolume(dimensions);

      expect(objectsManager.buildVolume?.x).toBe(100);
      expect(scene.children.some((child) => child.name === 'BuildVolume')).toBe(true);
    });

    test('setBuildVolume replaces an existing volume', () => {
      objectsManager.setBuildVolume(dimensions);
      const first = objectsManager.buildVolume;

      objectsManager.setBuildVolume({ x: 200, y: 200, z: 100, smallGrid: true });

      expect(objectsManager.buildVolume).not.toBe(first);
      expect(objectsManager.buildVolume?.x).toBe(200);
      expect(scene.children.filter((child) => child.name === 'BuildVolume')).toHaveLength(1);
    });

    test('setBuildVolume without dimensions removes the volume', () => {
      objectsManager.setBuildVolume(dimensions);

      objectsManager.setBuildVolume();

      expect(objectsManager.buildVolume).toBeUndefined();
      expect(scene.children.some((child) => child.name === 'BuildVolume')).toBe(false);
    });

    test('the build volume survives a geometry reset', () => {
      objectsManager.setBuildVolume(dimensions);
      const volume = objectsManager.buildVolume;

      objectsManager.reset();

      expect(objectsManager.buildVolume).toBe(volume);
      expect(scene.children.some((child) => child.name === 'BuildVolume')).toBe(true);
    });

    test('dispose removes the build volume from the scene', () => {
      objectsManager.setBuildVolume(dimensions);

      objectsManager.dispose();

      expect(objectsManager.buildVolume).toBeUndefined();
      expect(scene.children.some((child) => child.name === 'BuildVolume')).toBe(false);
    });
  });

  describe('bounding box', () => {
    function createBounds(): BoundingBox {
      const bounds = new BoundingBox();
      bounds.update(0, 0, 0);
      bounds.update(10, 20, 5);
      return bounds;
    }

    function meshesInScene(): number {
      return scene.children.filter((child) => child.name === 'bounding-box').length;
    }

    test('updateBoundingBox creates a hidden mesh when no color is set', () => {
      objectsManager.updateBoundingBox(createBounds());

      expect(objectsManager.boundingBoxMesh?.visible).toBe(false);
      expect(meshesInScene()).toBe(1);
    });

    test('updateBoundingBox draws the box at the model min corner in the configured color', () => {
      objectsManager.setBoundingBoxColor(new Color(0x00ff00));

      objectsManager.updateBoundingBox(createBounds());

      const mesh = objectsManager.boundingBoxMesh;
      expect(mesh?.visible).toBe(true);
      expect((mesh?.material as LineBasicMaterial).color.getHex()).toBe(0x00ff00);
      expect(mesh?.position.x).toBe(0);
      expect(mesh?.position.y).toBe(0);
    });

    test('updateBoundingBox ignores invalid bounds', () => {
      objectsManager.updateBoundingBox(new BoundingBox());

      expect(objectsManager.boundingBoxMesh).toBeUndefined();
    });

    test('updateBoundingBox reuses the mesh while the bounds are unchanged', () => {
      const bounds = createBounds();
      objectsManager.updateBoundingBox(bounds);
      const first = objectsManager.boundingBoxMesh;

      objectsManager.updateBoundingBox(bounds);

      expect(objectsManager.boundingBoxMesh).toBe(first);
      expect(meshesInScene()).toBe(1);
    });

    test('grown bounds rebuild the mesh', () => {
      const bounds = createBounds();
      objectsManager.updateBoundingBox(bounds);
      const first = objectsManager.boundingBoxMesh;

      bounds.update(50, 60, 40);
      objectsManager.updateBoundingBox(bounds);

      expect(objectsManager.boundingBoxMesh).not.toBe(first);
      expect(meshesInScene()).toBe(1);
    });

    test('setBoundingBoxColor recolors and toggles the existing mesh in place', () => {
      objectsManager.updateBoundingBox(createBounds());
      const mesh = objectsManager.boundingBoxMesh;

      objectsManager.setBoundingBoxColor(new Color(0xff00ff));

      expect(objectsManager.boundingBoxMesh).toBe(mesh);
      expect(mesh?.visible).toBe(true);
      expect((mesh?.material as LineBasicMaterial).color.getHex()).toBe(0xff00ff);

      objectsManager.setBoundingBoxColor(undefined);

      expect(mesh?.visible).toBe(false);
    });

    test('the bounding box survives a geometry reset', () => {
      objectsManager.updateBoundingBox(createBounds());
      const mesh = objectsManager.boundingBoxMesh;

      objectsManager.reset();

      expect(objectsManager.boundingBoxMesh).toBe(mesh);
      expect(meshesInScene()).toBe(1);
    });

    test('dispose removes the bounding box from the scene', () => {
      objectsManager.updateBoundingBox(createBounds());

      objectsManager.dispose();

      expect(objectsManager.boundingBoxMesh).toBeUndefined();
      expect(meshesInScene()).toBe(0);
    });
  });

  describe('group orientation', () => {
    test('groups are rotated to match coordinate system', () => {
      const expectedRotation = -Math.PI / 2;

      const extrusionEuler = objectsManager.extrusionsGroup.rotation;
      const travelEuler = objectsManager.travelMovesGroup.rotation;

      expect(extrusionEuler.x).toBeCloseTo(expectedRotation, 5);
      expect(travelEuler.x).toBeCloseTo(expectedRotation, 5);
    });
  });
});

/** The flat position buffer three.js interleaves the segment endpoints into. */
function positionsOf(lines: LineSegments2): Float32Array {
  return lines.geometry.attributes.instanceStart.data.array as Float32Array;
}

function createTestPath(): Path {
  const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);
  path.addPoint(0, 0, 0);
  path.addPoint(10, 0, 0);
  path.addPoint(10, 10, 0);
  return path;
}

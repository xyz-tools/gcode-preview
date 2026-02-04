import { test, expect, describe, vi, beforeEach } from 'vitest';
import { ObjectsManager } from '../objects-manager';
import { Path, PathType } from '../path';
import { Scene, Color, Group } from 'three';

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

    test('creates clipping planes', () => {
      expect(objectsManager.clippingPlanes.length).toBe(2);
    });
  });

  describe('visibility controls', () => {
    describe('hideTravels', () => {
      test('sets travelMovesGroup visibility to false', () => {
        objectsManager.showTravels();
        objectsManager.hideTravels();

        expect(objectsManager.travelMovesGroup.visible).toBe(false);
      });
    });

    describe('showTravels', () => {
      test('sets travelMovesGroup visibility to true', () => {
        objectsManager.hideTravels();
        objectsManager.showTravels();

        expect(objectsManager.travelMovesGroup.visible).toBe(true);
      });
    });

    describe('hideExtrusions', () => {
      test('sets extrusionsGroup visibility to false', () => {
        objectsManager.showExtrusions();
        objectsManager.hideExtrusions();

        expect(objectsManager.extrusionsGroup.visible).toBe(false);
      });
    });

    describe('showExtrusions', () => {
      test('sets extrusionsGroup visibility to true', () => {
        objectsManager.hideExtrusions();
        objectsManager.showExtrusions();

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

      expect(objectsManager.travelMovesGroup.children.length).toBe(2);
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

      expect(objectsManager.extrusionsGroup.children.length).toBe(2);
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

      expect(objectsManager.extrusionsGroup.children.length).toBe(2);
    });

    test('adds material to materials array', () => {
      const path = createTestPath();
      const color = new Color(0x0000ff);

      const initialMaterialCount = objectsManager.materials.length;
      objectsManager.renderExtrusionTubes([path], color);

      expect(objectsManager.materials.length).toBe(initialMaterialCount + 1);
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

function createTestPath(): Path {
  const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);
  path.addPoint(0, 0, 0);
  path.addPoint(10, 0, 0);
  path.addPoint(10, 10, 0);
  return path;
}

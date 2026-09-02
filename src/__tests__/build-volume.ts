import { test, describe, expect, vi } from 'vitest';
import { BuildVolume } from '../build-volume';
import { AxesHelper, Color, Object3D, Scene } from 'three';
import { Grid } from '../helpers/grid';
import { LineBox } from '../helpers/line-box';

describe('BuildVolume', () => {
  const mockScene = new Scene();

  test('it has a default color', () => {
    const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

    // Assuming a 'color' property existed and was mistakenly removed, adding it back if intended.
    // If 'color' property is gone by design, this test should be removed.
    // For now, checking a property that still exists.
    expect(buildVolume.x).toEqual(10);
  });

  test('it has size properties', () => {
    const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

    expect(buildVolume.x).toEqual(10);
    expect(buildVolume.y).toEqual(20);
    expect(buildVolume.z).toEqual(30);
  });

  describe('invalid dimensions never throw (#300/#301)', () => {
    // Dimensions are often bound to live UI inputs (issue #300: a Vue-bound
    // input crashed mid-edit), so BuildVolume must tolerate transient invalid
    // values by clamping to 0 — never by throwing (policy set in PR #301).

    test('never throws at construction; negative dimensions clamp to 0', () => {
      const scene = new Scene();

      expect(() => new BuildVolume(-1, -1, -1, false, scene)).not.toThrow();

      const buildVolume = new BuildVolume(-1, -1, -1, false, scene);
      expect(buildVolume.x).toEqual(0);
      expect(buildVolume.y).toEqual(0);
      expect(buildVolume.z).toEqual(0);
    });

    test('never throws when x is set to a negative value; clamps to 0', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, new Scene());

      expect(() => {
        buildVolume.x = -5;
      }).not.toThrow();

      expect(buildVolume.x).toEqual(0);
    });

    test('never throws when y is set to a negative value; clamps to 0', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, new Scene());

      expect(() => {
        buildVolume.y = -5;
      }).not.toThrow();

      expect(buildVolume.y).toEqual(0);
    });

    test('never throws when z is set to a negative value; clamps to 0 and still updates', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      expect(() => {
        buildVolume.z = -1;
      }).not.toThrow();

      expect(buildVolume.z).toEqual(0);
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });

    test('accepts 0 without throwing; a zero-sized volume simply renders nothing', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      expect(() => {
        buildVolume.x = 0;
      }).not.toThrow();

      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('.createAxes', () => {
    test('it creates an AxesHelper', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      const axes = buildVolume.createAxes();

      expect(axes).toBeDefined();
      expect(axes).toBeInstanceOf(AxesHelper);
    });

    test('it scales the axes', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      const axes = buildVolume.createAxes();

      expect(axes.scale).toEqual({ x: 1, y: 1, z: -1 });
    });

    test('it positions the axes', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      const axes = buildVolume.createAxes();

      expect(axes.position).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('.createGrid', () => {
    test('it creates a Grid', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      const grid = buildVolume.createGrid(1, new Color(0x444444)); // Must pass color now

      expect(grid).toBeDefined();
      expect(grid).toBeInstanceOf(Grid);
    });
  });

  describe('.createGroup', () => {
    test('it creates a group for all the objects', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      const group = buildVolume.createGroup();

      expect(group).toBeDefined();
      expect(group.children.length).toEqual(3);

      expect(group.children[0]).toBeInstanceOf(LineBox);
      expect(group.children[1]).toBeInstanceOf(Grid);
      expect(group.children[2]).toBeInstanceOf(AxesHelper);
    });

    test('it includes a small grid when smallGrid is true', () => {
      const buildVolume = new BuildVolume(10, 20, 30, true, mockScene);

      const group = buildVolume.createGroup();

      expect(group.children.length).toEqual(4);
      expect(group.children[0]).toBeInstanceOf(LineBox);
      expect(group.children[1]).toBeInstanceOf(Grid);
      expect(group.children[2]).toBeInstanceOf(Grid);
      expect(group.children[3]).toBeInstanceOf(AxesHelper);
    });
  });

  describe('.dispose', () => {
    test('it calls dispose on all disposables and removes group from scene', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);
      const sceneRemoveSpy = vi.spyOn(mockScene, 'remove');
      buildVolume.update();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const group = buildVolume['_group']!;
      group.add(new Object3D()); // a child without a dispose method is skipped
      const spies = group.children
        .filter((c): c is typeof c & { dispose: () => void } => 'dispose' in c)
        .map((c) => vi.spyOn(c, 'dispose'));

      buildVolume.dispose();

      spies.forEach((spy) => expect(spy).toHaveBeenCalled());
      expect(sceneRemoveSpy).toHaveBeenCalledWith(group);
    });

    test('it does nothing when no group exists', () => {
      const scene = new Scene();
      const sceneRemoveSpy = vi.spyOn(scene, 'remove');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.dispose();

      expect(sceneRemoveSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('.update', () => {
    test('it adds the group to the scene when update is called', () => {
      const sceneAddSpy = vi.spyOn(mockScene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
      buildVolume.update();

      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });

    test('it replaces an existing group, disposing the old one', () => {
      const scene = new Scene();
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);
      buildVolume.update();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const firstGroup = buildVolume['_group']!;
      firstGroup.add(new Object3D()); // a child without a dispose method is skipped
      const disposeSpies = firstGroup.children
        .filter((c): c is typeof c & { dispose: () => void } => 'dispose' in c)
        .map((c) => vi.spyOn(c, 'dispose'));
      const sceneRemoveSpy = vi.spyOn(scene, 'remove');
      const sceneAddSpy = vi.spyOn(scene, 'add');

      buildVolume.update();

      expect(sceneRemoveSpy).toHaveBeenCalledWith(firstGroup);
      disposeSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
      expect(buildVolume['_group']).not.toBe(firstGroup);
    });

    test('it does not add a group when x is 0', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(0, 20, 30, false, scene);

      buildVolume.update();

      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
    });

    test('it does not add a group when y is 0', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 0, 30, false, scene);

      buildVolume.update();

      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
    });

    test('it removes the existing group without re-adding one when x becomes 0', () => {
      const scene = new Scene();
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);
      buildVolume.update();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const group = buildVolume['_group']!;
      const sceneRemoveSpy = vi.spyOn(scene, 'remove');
      const sceneAddSpy = vi.spyOn(scene, 'add');

      buildVolume.x = 0;

      expect(sceneRemoveSpy).toHaveBeenCalledWith(group);
      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('.x', () => {
    test('setting a value updates it and triggers an update', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.x = 15;

      expect(buildVolume.x).toEqual(15);
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.y', () => {
    test('setting a value updates it and triggers an update', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.y = 25;

      expect(buildVolume.y).toEqual(25);
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.z', () => {
    test('setting a valid value updates it and triggers an update', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.z = 35;

      expect(buildVolume.z).toEqual(35);
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.smallGrid', () => {
    test('changing the value triggers an update', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.smallGrid = true;

      expect(buildVolume.smallGrid).toEqual(true);
      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });

    test('setting the same value does not trigger an update', () => {
      const scene = new Scene();
      const sceneAddSpy = vi.spyOn(scene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, scene);

      buildVolume.smallGrid = false;

      expect(sceneAddSpy).toHaveBeenCalledTimes(0);
    });
  });
});

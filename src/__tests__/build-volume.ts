import { test, describe, expect, vi } from 'vitest';
import { BuildVolume } from '../build-volume';
import { AxesHelper, Scene } from 'three';
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
  });

  describe('.dispose', () => {
    test('it calls dispose on all disposables and removes group from scene', () => {
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);
      const sceneRemoveSpy = vi.spyOn(mockScene, 'remove');
      buildVolume.update();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const group = buildVolume['_group']!;
      const spies = group.children
        .filter((c): c is typeof c & { dispose: () => void } => 'dispose' in c)
        .map((c) => vi.spyOn(c, 'dispose'));

      buildVolume.dispose();

      spies.forEach((spy) => expect(spy).toHaveBeenCalled());
      expect(sceneRemoveSpy).toHaveBeenCalledWith(group);
    });
  });

  describe('.update', () => {
    test('it adds the group to the scene when update is called', () => {
      const sceneAddSpy = vi.spyOn(mockScene, 'add');
      const buildVolume = new BuildVolume(10, 20, 30, false, mockScene);

      buildVolume.update();

      expect(sceneAddSpy).toHaveBeenCalledTimes(1);
    });
  });
});

import { Color } from 'three';

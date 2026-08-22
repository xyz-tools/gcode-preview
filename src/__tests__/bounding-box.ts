import { describe, it, expect } from 'vitest';
import { BoundingBox } from '../bounding-box';

describe('BoundingBox', () => {
  describe('isValid', () => {
    it('is false before any point has been added', () => {
      const bbox = new BoundingBox();
      expect(bbox.isValid).toBe(false);
    });

    it('is true after a single point has been added', () => {
      const bbox = new BoundingBox();
      bbox.update(1, 2, 3);
      expect(bbox.isValid).toBe(true);
    });
  });

  describe('size', () => {
    it('returns null before any point has been added', () => {
      const bbox = new BoundingBox();
      expect(bbox.size).toBeNull();
    });

    it('is zero in every dimension for a single point', () => {
      const bbox = new BoundingBox();
      bbox.update(4, 5, 6);
      expect(bbox.size).toMatchObject({ x: 0, y: 0, z: 0 });
    });

    it('spans the extremes of all added points', () => {
      const bbox = new BoundingBox();
      bbox.update(10, 20, 30);
      bbox.update(-2, 4, 6);
      bbox.update(3, 40, -1);
      expect(bbox.size).toMatchObject({ x: 12, y: 36, z: 31 });
    });
  });

  describe('center', () => {
    it('returns null before any point has been added', () => {
      const bbox = new BoundingBox();
      expect(bbox.center).toBeNull();
    });

    it('is the per-axis midpoint of the extremes, independent of point order', () => {
      const bbox = new BoundingBox();
      bbox.update(30, 4, 6);
      bbox.update(-10, 8, 0);
      bbox.update(5, 6, 2);
      expect(bbox.center).toMatchObject({ x: 10, y: 6, z: 3 });
    });

    it('equals the point itself when only one point has been added', () => {
      const bbox = new BoundingBox();
      bbox.update(7, -2, 3.5);
      expect(bbox.center).toMatchObject({ x: 7, y: -2, z: 3.5 });
    });
  });

  describe('non-finite coordinates', () => {
    it('a NaN coordinate does not make the box valid', () => {
      const bbox = new BoundingBox();
      bbox.update(NaN, 5, 5);
      expect(bbox.isValid).toBe(false);
      expect(bbox.size).toBeNull();
      expect(bbox.center).toBeNull();
      expect(bbox.corners).toBeNull();
    });

    it('a NaN coordinate does not poison an already-valid box', () => {
      const bbox = new BoundingBox();
      bbox.update(1, 2, 3);
      bbox.update(NaN, 10, 10);
      expect(bbox.isValid).toBe(true);
      expect(bbox.size).toMatchObject({ x: 0, y: 0, z: 0 });
      expect(bbox.center).toMatchObject({ x: 1, y: 2, z: 3 });
    });

    it('rejects a point with a NaN y or z coordinate', () => {
      const yBox = new BoundingBox();
      yBox.update(1, NaN, 2);
      expect(yBox.isValid).toBe(false);

      const zBox = new BoundingBox();
      zBox.update(1, 2, NaN);
      expect(zBox.isValid).toBe(false);
    });

    it('an Infinity coordinate is rejected too', () => {
      const xBox = new BoundingBox();
      xBox.update(Infinity, 0, 0);
      expect(xBox.isValid).toBe(false);

      const yBox = new BoundingBox();
      yBox.update(0, Infinity, 0);
      expect(yBox.isValid).toBe(false);
      expect(yBox.size).toBeNull();

      const zBox = new BoundingBox();
      zBox.update(0, 0, -Infinity);
      expect(zBox.isValid).toBe(false);
    });
  });

  describe('corners', () => {
    it('returns null before any point has been added', () => {
      const bbox = new BoundingBox();
      expect(bbox.corners).toBeNull();
    });

    it('tracks per-axis minima and maxima independently of point order', () => {
      const bbox = new BoundingBox();
      bbox.update(10, -5, 0);
      bbox.update(-3, 8, 20);
      const { min, max } = bbox.corners!;
      expect(min).toMatchObject({ x: -3, y: -5, z: 0 });
      expect(max).toMatchObject({ x: 10, y: 8, z: 20 });
    });

    it('returns copies that do not affect the bounding box when mutated', () => {
      const bbox = new BoundingBox();
      bbox.update(1, 1, 1);
      bbox.update(9, 9, 9);
      const { min, max } = bbox.corners!;
      min.x = -100;
      max.x = 100;
      expect(bbox.corners!.min).toMatchObject({ x: 1, y: 1, z: 1 });
      expect(bbox.corners!.max).toMatchObject({ x: 9, y: 9, z: 9 });
      expect(bbox.size).toMatchObject({ x: 8, y: 8, z: 8 });
    });
  });
});

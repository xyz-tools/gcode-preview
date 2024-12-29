import { test, expect, describe } from 'vitest';
import { Path, PathType } from '../path';
import { ExtrusionGeometry } from '../extrusion-geometry';
import { BufferGeometry } from 'three';

test('.addPoint adds a point to the vertices', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  path.addPoint(1, 2, 3);

  expect(path.vertices).not.toBeNull();
  expect(path.vertices.length).toEqual(3);
});

test('.addPoint adds points at the end of vertices', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  path.addPoint(0, 0, 0);
  path.addPoint(1, 2, 3);
  path.addPoint(5, 6, 7);

  expect(path.vertices).not.toBeNull();
  expect(path.vertices.length).toEqual(9);
  expect(path.vertices[6]).toEqual(5);
  expect(path.vertices[7]).toEqual(6);
  expect(path.vertices[8]).toEqual(7);
});

test('.checkLineContinuity returns false if there are less than 3 vertices', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  expect(path.checkLineContinuity(0, 0, 0)).toBeFalsy();
});

test('.checkLineContinuity returns false if the last point is different', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  path.addPoint(0, 0, 0);
  path.addPoint(1, 2, 3);

  expect(path.checkLineContinuity(1, 2, 4)).toBeFalsy();
});

test('.checkLineContinuity returns true if the last point is the same', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  path.addPoint(0, 0, 0);
  path.addPoint(1, 2, 3);

  expect(path.checkLineContinuity(1, 2, 3)).toBeTruthy();
});

test('.path returns an array of Vector3', () => {
  const path = new Path(PathType.Travel, undefined, undefined, undefined);

  path.addPoint(0, 0, 0);
  path.addPoint(1, 2, 3);

  const result = path.path();

  expect(result).not.toBeNull();
  expect(result.length).toEqual(2);
  expect(result[0]).toEqual({ x: 0, y: 0, z: 0 });
  expect(result[1]).toEqual({ x: 1, y: 2, z: 3 });
});

describe('.geometry', () => {
  test('returns an ExtrusionGeometry from the path', () => {
    const path = new Path(PathType.Travel, undefined, undefined, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.geometry() as ExtrusionGeometry;

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(ExtrusionGeometry);
    expect(result.parameters.points.length).toEqual(2);
    expect(result.parameters.closed).toEqual(false);
  });

  test('returns an ExtrusionGeometry with the path extrusion width', () => {
    const path = new Path(PathType.Travel, 9, undefined, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.geometry() as ExtrusionGeometry;

    expect(result.parameters.lineWidth).toEqual(9);
  });

  test('returns an ExtrusionGeometry with the path line height', () => {
    const path = new Path(PathType.Travel, undefined, 5, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.geometry() as ExtrusionGeometry;

    expect(result.parameters.lineHeight).toEqual(5);
  });

  test('returns an ExtrusionGeometry with the extrusionWidthOverride when passed', () => {
    const path = new Path(PathType.Travel, 9, undefined, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.geometry({ extrusionWidthOverride: 2 }) as ExtrusionGeometry;

    expect(result.parameters.lineWidth).toEqual(2);
  });

  test('returns an ExtrusionGeometry with the lineHeightOverride when passed', () => {
    const path = new Path(PathType.Travel, undefined, 5, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.geometry({ lineHeightOverride: 7 }) as ExtrusionGeometry;

    expect(result.parameters.lineHeight).toEqual(7);
  });

  test('returns null if there are 0 vertices', () => {
    const path = new Path(PathType.Travel, undefined, undefined, undefined);

    const result = path.geometry();

    expect(result).toBeNull();
  });

  test('returns null if there are less than 6 vertices', () => {
    const path = new Path(PathType.Travel, undefined, undefined, undefined);

    path.addPoint(0, 0, 0);

    const result = path.geometry();

    expect(result).toBeNull();
  });
});

describe('.line', () => {
  test('returns a BufferGeometry from the path', () => {
    const path = new Path(PathType.Travel, undefined, undefined, undefined);

    path.addPoint(0, 0, 0);
    path.addPoint(1, 2, 3);

    const result = path.line();

    expect(result).not.toBeNull();
    const points = result.attributes['instanceStart'].array;
    expect(points).toEqual(Float32Array.from([0, 0, 0, 1, 2, 3]));
  });

  test('returns a BufferGeometry when there are no vertices', () => {
    const path = new Path(PathType.Travel, undefined, undefined, undefined);

    const result = path.line();

    expect(result).not.toBeNull();
    const points = result.attributes['instanceStart'].array;
    expect(points.length).toEqual(0);
  });
});

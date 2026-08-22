import { test, expect } from 'vitest';
import { BufferGeometry, Vector3 } from 'three';
import { ExtrusionGeometry } from '../extrusion-geometry';

test('ExtrusionGeometry should be defined', () => {
  expect(ExtrusionGeometry).toBeDefined();
});

test('ExtrusionGeometry extends BufferGeometry', () => {
  const geometry = new ExtrusionGeometry();
  expect(geometry).toBeInstanceOf(ExtrusionGeometry);
  expect(geometry).toBeInstanceOf(BufferGeometry);
});

test('ExtrusionGeometry should be of type "ExtrusionGeometry"', () => {
  const geometry = new ExtrusionGeometry();
  expect(geometry.type).toBe('ExtrusionGeometry');
});

test('ExtrusionGeometry should have default values', () => {
  const geometry = new ExtrusionGeometry();
  expect(geometry.parameters.points).toEqual([new Vector3()]);
  expect(geometry.parameters.lineWidth).toBe(0.6);
  expect(geometry.parameters.lineHeight).toBe(0.2);
  expect(geometry.parameters.radialSegments).toBe(8);
});

test('ExtrusionGeometry constructor should set values', () => {
  const points = [new Vector3(), new Vector3()];
  const lineWidth = 0.5;
  const lineHeight = 0.3;
  const radialSegments = 10;
  const geometry = new ExtrusionGeometry(points, lineWidth, lineHeight, radialSegments);
  expect(geometry.parameters.points).toEqual(points);
  expect(geometry.parameters.lineWidth).toBe(lineWidth);
  expect(geometry.parameters.lineHeight).toBe(lineHeight);
  expect(geometry.parameters.radialSegments).toBe(radialSegments);
});

test('ExtrusionGeometry should set normals, uvs and indices', () => {
  const points = [new Vector3(0, 0, 0), new Vector3(1, 0, 0)];
  const geometry = new ExtrusionGeometry(points);
  expect(geometry.attributes.position).toBeDefined();
  expect(geometry.attributes.normal).toBeDefined();
  expect(geometry.attributes.uv).toBeDefined();
});

test('ExtrusionGeometry should generate buffer data', () => {
  const points = [new Vector3(0, 0, 0), new Vector3(1, 0, 0)];
  const geometry = new ExtrusionGeometry(points);
  expect(geometry.attributes.position.array.length).toBeGreaterThan(0);
  expect(geometry.attributes.normal.array.length).toBeGreaterThan(0);
  expect(geometry.attributes.uv.array.length).toBeGreaterThan(0);
});

test('ExtrusionGeometry fills its buffers exactly, with no slack', () => {
  // The buffers are sized from the path topology before being filled, so a
  // trailing zero would mean the size formula and the fill loop disagree.
  const radialSegments = 6;
  const points = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 1, 1)];
  const geometry = new ExtrusionGeometry(points, 0.6, 0.2, radialSegments);

  const ring = radialSegments + 1;
  expect(geometry.attributes.position.count).toBe((points.length + 1) * ring);
  expect(geometry.attributes.normal.count).toBe((points.length + 1) * ring);
  expect(geometry.attributes.uv.count).toBe(points.length * ring);
  expect(geometry.index.count).toBe((points.length - 1) * radialSegments * 6);

  // last index written must be a real face, not a zero left by an oversized buffer
  const indices = geometry.index.array;
  expect(indices[indices.length - 1]).toBeGreaterThan(0);
});

test('ExtrusionGeometry widens its index buffer when the vertex count needs it', () => {
  const narrow = new ExtrusionGeometry([new Vector3(0, 0, 0), new Vector3(1, 0, 0)], 0.6, 0.2, 4);
  expect(narrow.index.array).toBeInstanceOf(Uint16Array);

  // 65535 vertices is the point where 16 bit indices stop being addressable
  const radialSegments = 4;
  const pointsNeeded = Math.ceil(65536 / (radialSegments + 1));
  const longPath = Array.from({ length: pointsNeeded }, (_, i) => new Vector3(i, 0, 0));
  const wide = new ExtrusionGeometry(longPath, 0.6, 0.2, radialSegments);

  expect(wide.attributes.position.count).toBeGreaterThan(65535);
  expect(wide.index.array).toBeInstanceOf(Uint32Array);
  // and the widest index it wrote is still addressable
  expect(Math.max(...Array.from(wide.index.array.slice(-6)))).toBeLessThan(wide.attributes.position.count);
});

test('ExtrusionGeometry walks the ring in the order the trig dictates', () => {
  // Four radial segments land on the axes, so the ring around a path running
  // along +X is exact: up, left, down, right, back to the start. Any drift in
  // the precomputed sin/cos table shows up here immediately.
  const points = [new Vector3(0, 0, 0), new Vector3(1, 0, 0)];
  const geometry = new ExtrusionGeometry(points, 2, 2, 4);

  const round = (n: number) => {
    const rounded = Math.round(n * 1e6) / 1e6;
    return rounded === 0 ? 0 : rounded; // collapse -0
  };
  const firstRing = Array.from(geometry.attributes.normal.array.slice(0, 15)).map(round);

  expect(firstRing).toEqual([0, 0, 1, 0, 1, 0, 0, 0, -1, 0, -1, 0, 0, 0, 1]);
});

test('ExtrusionGeometry keeps every ring normal a unit vector', () => {
  const points = [new Vector3(0, 0, 0), new Vector3(1, 2, 3), new Vector3(4, 4, 4)];
  const geometry = new ExtrusionGeometry(points, 0.6, 0.2, 8);

  const normals = geometry.attributes.normal.array;
  for (let i = 0; i < normals.length; i += 3) {
    expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 5);
  }
});

test('ExtrusionGeometry produces the same ring for every point on the path', () => {
  // Every point re-uses the same table, so a straight path repeats one ring.
  const radialSegments = 4;
  const ring = (radialSegments + 1) * 3;
  const points = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)];
  const geometry = new ExtrusionGeometry(points, 0.6, 0.2, radialSegments);

  const normals = geometry.attributes.normal.array;
  const firstRing = Array.from(normals.slice(0, ring));
  const secondRing = Array.from(normals.slice(ring, ring * 2));

  expect(secondRing).toEqual(firstRing);
});

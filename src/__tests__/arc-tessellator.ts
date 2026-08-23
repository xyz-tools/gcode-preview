import { test, expect, describe } from 'vitest';
import { ArcTessellator, ArcMove, ArcPoint } from '../arc-tessellator';

describe('ArcTessellator', () => {
  const tessellator = new ArcTessellator();

  function tessellate(start: ArcPoint, move: ArcMove, units: 'mm' | 'in' = 'mm'): ArcPoint[] {
    const points: ArcPoint[] = [];
    tessellator.tessellate(start, move, (x, y, z) => points.push({ x, y, z }), units);
    return points;
  }

  test('tessellates a counter-clockwise quarter circle onto the arc', () => {
    // start (1,0), center (0,0), end (0,1)
    const points = tessellate({ x: 1, y: 0, z: 0 }, { cw: false, x: 0, y: 1, i: -1, j: 0 });

    expect(points.length).toBeGreaterThan(1);
    for (const point of points) {
      expect(Math.sqrt(point.x * point.x + point.y * point.y)).toBeCloseTo(1, 6);
    }
  });

  test('ends exactly on the target coordinates and returns the endpoint', () => {
    const points: ArcPoint[] = [];
    const endPoint = tessellator.tessellate({ x: 1, y: 0, z: 0 }, { cw: false, x: 0, y: 1, i: -1, j: 0 }, (x, y, z) =>
      points.push({ x, y, z })
    );

    expect(endPoint).toEqual({ x: 0, y: 1, z: 0 });
    expect(points[points.length - 1]).toEqual(endPoint);
  });

  test('sweeps through opposite half-planes for cw and ccw arcs', () => {
    const start = { x: 1, y: 0, z: 0 };
    const move = { x: -1, y: 0, i: -1, j: 0 };

    const ccw = tessellate(start, { cw: false, ...move });
    const cw = tessellate(start, { cw: true, ...move });

    // both are half circles around (0,0); ccw passes through +Y, cw through -Y
    expect(Math.max(...ccw.map((p) => p.y))).toBeCloseTo(1, 1);
    expect(Math.min(...cw.map((p) => p.y))).toBeCloseTo(-1, 1);
  });

  test('keeps omitted axes at their start values', () => {
    const points = tessellate({ x: 3, y: 4, z: 5 }, { cw: true, i: 1, j: 0 });

    const endPoint = points[points.length - 1];
    expect(endPoint).toEqual({ x: 3, y: 4, z: 5 });
  });

  test('emits only the endpoint for a degenerate R-mode whole circle', () => {
    const points = tessellate({ x: 1, y: 1, z: 0 }, { cw: true, x: 1, y: 1, r: 5 });

    expect(points).toEqual([{ x: 1, y: 1, z: 0 }]);
  });

  test('emits a single straight segment for an arc shorter than one step', () => {
    // ~0.1 rad of sweep on r=10 is below the coarsest allowed step, so the
    // segment count clamps to 1 and only the endpoint is emitted
    const end = { x: 10 * Math.cos(0.1), y: 10 * Math.sin(0.1) };
    const points = tessellate({ x: 10, y: 0, z: 0 }, { cw: false, x: end.x, y: end.y, i: -10, j: 0 });

    expect(points).toEqual([{ x: end.x, y: end.y, z: 0 }]);
  });

  test('converts R mode to a clockwise arc that stays on the circle', () => {
    const points = tessellate({ x: 0, y: 0, z: 0 }, { cw: true, x: 2, y: 0, r: 1 });

    for (const point of points) {
      const dx = point.x - 1;
      const dy = point.y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(1, 6);
    }
  });

  test('converts R mode to an arc that stays on a circle through start and end', () => {
    // r equals half the start-end distance, so the center is the midpoint (1,0)
    const points = tessellate({ x: 0, y: 0, z: 0 }, { cw: false, x: 2, y: 0, r: 1 });

    for (const point of points) {
      const dx = point.x - 1;
      const dy = point.y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(1, 6);
    }
  });

  test('interpolates Z monotonically along a helical arc', () => {
    const points = tessellate({ x: 10, y: 0, z: 1 }, { cw: false, x: -10, y: 0, z: 3, i: -10, j: 0 });

    let previousZ = 1;
    for (const point of points) {
      expect(point.z).toBeGreaterThan(previousZ);
      previousZ = point.z;
    }
    expect(points[points.length - 1].z).toEqual(3);
  });

  test('keeps every chord within the tolerance of the true arc', () => {
    // quarter circle of radius 100 around (0,0); default tolerance is 0.05mm
    const points = [
      { x: 100, y: 0, z: 0 },
      ...tessellate({ x: 100, y: 0, z: 0 }, { cw: false, x: 0, y: 100, i: -100, j: 0 })
    ];

    for (let index = 1; index < points.length; index++) {
      const midX = (points[index - 1].x + points[index].x) / 2;
      const midY = (points[index - 1].y + points[index].y) / 2;
      const sagitta = 100 - Math.sqrt(midX * midX + midY * midY);
      expect(sagitta).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  test('spends far fewer segments on large arcs than fixed-length chords would', () => {
    // 0.5mm-long chords would put ~314 points on this arc
    const points = tessellate({ x: 100, y: 0, z: 0 }, { cw: false, x: 0, y: 100, i: -100, j: 0 });

    expect(points.length).toBeLessThan(40);
    expect(points.length).toBeGreaterThan(10);
  });

  test('a tighter chord tolerance produces more points', () => {
    const fine = new ArcTessellator({ chordTolerance: 0.005 });
    const start = { x: 10, y: 0, z: 0 };
    const move = { cw: false, x: -10, y: 0, i: -10, j: 0 };

    const coarsePoints = tessellate(start, move);
    const finePoints: ArcPoint[] = [];
    fine.tessellate(start, move, (x, y, z) => finePoints.push({ x, y, z }));

    expect(finePoints.length).toBeGreaterThan(coarsePoints.length);
  });

  test('keeps tiny circles round despite the tolerance allowing coarse steps', () => {
    // whole circle with a radius near the tolerance; the max segment angle
    // caps the step at 22.5 degrees, so a full turn gets at least 16 points
    const points = tessellate({ x: 0.2, y: 0, z: 0 }, { cw: true, x: 0.2, y: 0, i: -0.2, j: 0 });

    expect(points.length).toBeGreaterThanOrEqual(16);
  });

  test('emits more segments for the same arc in inches', () => {
    const start = { x: 1, y: 0, z: 0 };
    const move = { cw: false, x: 0, y: 1, i: -1, j: 0 };

    const mm = tessellate(start, move, 'mm');
    const inches = tessellate(start, move, 'in');

    expect(inches.length).toBeGreaterThan(mm.length);
  });
});

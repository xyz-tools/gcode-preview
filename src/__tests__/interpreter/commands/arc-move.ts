import { test, expect, describe } from 'vitest';
import { GCodeCommand, Parser } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { arcMove } from '../../../interpreter/commands';
import { Job } from '../../../job';
import { PathType } from '../../../path';

describe('arcMove (G2/G3)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('a retracting arc is a travel move, matching G0/G1 (negative E)', () => {
    // g0/g1 classify negative E (a retraction) as Travel via `e > 0`. g2/g3 used the
    // looser `e ?`, so a negative E arc was misclassified as Extrusion: it rendered as
    // deposited material and, worse, stretched the bounding box out along the arc even
    // though nothing was extruded.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E-1'].join('\n'));

    // The arc must not be lumped onto the preceding extrusion path.
    const lastPath = job.paths[job.paths.length - 1];
    expect(lastPath.travelType).toEqual(PathType.Travel);

    // A travel move never grows the print bounds, so the box stays where the
    // extrusion left it instead of stretching to the arc's far side (x = 20).
    expect(job.boundingBox.corners?.max.x).toEqual(10);
  });

  test('a positive-E arc still extrudes and grows the bounding box', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    const lastPath = job.paths[job.paths.length - 1];
    expect(lastPath.travelType).toEqual(PathType.Extrusion);
    expect(job.boundingBox.corners?.max.x).toEqual(20);
  });

  test('keeps the current Y when an arc omits it', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 I5 J0 E1'].join('\n'));

    expect(job.state.y).toEqual(10);
    expect(job.paths.flatMap((path) => path.vertices).every((value) => Number.isFinite(value))).toBe(true);
  });

  test('R mode computes a centre and renders a curved arc', () => {
    // R mode (radius instead of I/J offsets) has to solve for the centre. Exercise the
    // non-degenerate branch with r larger than half the chord so the curve bulges.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 R10 E1'].join('\n'));

    const arcPath = job.paths[job.paths.length - 1];
    const points = arcPath.path();
    // more than just start + endpoint: real intermediate segments were emitted
    expect(points.length).toBeGreaterThan(2);
    expect(arcPath.vertices.every((value) => Number.isFinite(value))).toBe(true);
    // ends exactly on the requested endpoint
    expect(points[points.length - 1]).toMatchObject({ x: 20, y: 10 });
  });

  test('R mode counter-clockwise (G3) selects the opposite centre', () => {
    // g3 with a positive radius flips the sign of the centre offset. Both arcs share
    // endpoints but bow to opposite sides, so their mid-point Y differs.
    const cw = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 R10 E1'].join('\n'));
    const ccw = run(['G1 X10 Y10 Z1 E1', 'G3 X20 Y10 R10 E1'].join('\n'));

    const midY = (job: Job) => {
      const pts = job.paths[job.paths.length - 1].path();
      return pts[Math.floor(pts.length / 2)].y;
    };

    expect(midY(cw)).not.toBeCloseTo(midY(ccw));
    // clockwise from (10,10) to (20,10) bows above the chord, ccw bows below
    expect(midY(cw)).toBeGreaterThan(10);
    expect(midY(ccw)).toBeLessThan(10);
  });

  test('arcs in inch units are segmented more finely than in mm', () => {
    // Inch arcs multiply the segment count so the on-screen curve stays smooth despite
    // the much smaller numeric radius.
    const mm = run(['G21', 'G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));
    const inch = run(['G20', 'G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    const segCount = (job: Job) => job.paths[job.paths.length - 1].path().length;
    expect(segCount(inch)).toBeGreaterThan(segCount(mm));
  });

  test('an arc shorter than one chord step still emits the endpoint (segment count clamped to 1)', () => {
    // A ~0.05 rad sweep on r=10 is below the chord-tolerance step (~0.2 rad), so the
    // count is clamped to 1: the endpoint is always emitted and the loop adds no
    // interior points. (A sub-millimetre *radius* no longer exercises the clamp: the
    // max-segment-angle cap deliberately keeps tiny circles round instead.)
    // A travel lead-in keeps the extrusion arc on its own path so we count only its points.
    const job = run(['G0 X10 Y10 Z1', 'G2 X10.0125 Y10.4998 I10 J0 E1'].join('\n'));

    const arcPath = job.paths[job.paths.length - 1];
    const points = arcPath.path();
    // start-of-path point + endpoint only, no interior segments
    expect(points.length).toEqual(2);
    expect(points[points.length - 1]).toMatchObject({ x: 10.0125, y: 10.4998 });
  });

  test('relative positioning applies to arc endpoints', () => {
    const command = new GCodeCommand('G2 X10 Y0 Z5 I5 J0', 'g2', {
      x: 10,
      y: 0,
      z: 5,
      i: 5,
      j: 0
    });
    const job = new Job();
    job.state.x = 10;
    job.state.y = 20;
    job.state.z = 30;
    job.state.positioning = 'relative';

    arcMove(command, job);

    expect(job.state.x).toEqual(20);
    expect(job.state.y).toEqual(20);
    expect(job.state.z).toEqual(35);
    expect(job.inprogressPath?.vertices.slice(-3)).toEqual([20, 20, 35]);
  });
});

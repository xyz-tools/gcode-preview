import { test, expect, describe } from 'vitest';
import { Parser } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';

describe('relative extrusion position', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test.each<[string, number]>([
    ['G1 X20 E3', 3],
    ['G0 X20 E-2', -2],
    ['G1 E3', 3],
    ['G0 E-2', -2],
    ['G1 E0', 0],
    ['G0 X20', 0],
    ['G2 X20 Y10 I5 J0 E3', 3],
    ['G3 X20 Y10 I5 J0 E-2', -2],
    ['G2 X20 Y10 I5 J0 E0', 0],
    ['G3 X20 Y10 I5 J0', 0]
  ])('tracks %s without applying the offset to relative E', (move, delta) => {
    const start = 'G1 X10 Y10 E5';
    const job = run([start, 'G92 E2', move].join('\n'));
    const unshifted = run([start, move].join('\n'));

    expect(job.state.e).toEqual(5 + delta);
    expect(job.state.positionShift.e).toEqual(3);
    expect(job.paths).toEqual(unshifted.paths);
    expect(job.stats).toEqual(unshifted.stats);
  });

  test('a bare G92 rebases E-only movement without creating geometry', () => {
    const job = run(['G1 E5', 'G1 E-2', 'G92'].join('\n'));

    expect(job.state.e).toEqual(3);
    expect(job.state.positionShift.e).toEqual(3);
    expect(job.paths).toEqual([]);
    expect(job.state.isHomed).toBe(false);
  });
});

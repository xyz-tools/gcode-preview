import { test, expect, describe } from 'vitest';
import { Parser } from '../../../parser/gcode-parser';
import { Interpreter, handlers } from '../../../interpreter';
import { PathType } from '../../../path';

describe('probe (G38.2-G38.5)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test.each(['G38.2', 'G38.3', 'G38.4', 'G38.5'])('%s is handled by the same handler as G31', (gcode) => {
    expect(handlers.get(gcode.toLowerCase())).toBe(handlers.get('g31'));
  });

  test.each(['G38.2', 'G38.3', 'G38.4', 'G38.5'])(
    'a downward %s crossing the origin plane is assumed to trigger at Z0',
    (gcode) => {
      const job = run(['G0 Z0.5', `${gcode} Z-10`].join('\n'));

      expect(job.state.z).toEqual(0);
      expect(job.paths[0].travelType).toEqual(PathType.Travel);
      expect(job.paths[0].vertices).toEqual([0, 0, 0, 0, 0, 0.5, 0, 0, 0]);
    }
  );

  test('a G38.2 touch-off cycle converges like G31', () => {
    const cycle = ['G0 Z0.2', 'G38.2 Z-11.8', 'G92 Z0', 'G0 Z0.039', 'G92 Z0'];
    const job = run([...cycle, ...cycle].join('\n'));

    expect(job.state.positionShift.z).toEqual(0.039);
    expect(job.state.z).toEqual(0.039);
  });

  test('an away probe to a clear target travels to the commanded target', () => {
    // G38.4/G38.5 probe away from the workpiece; a preview cannot observe the
    // contact break, so the move renders like any other probe
    const job = run(['G0 Z0.5', 'G38.4 Z3'].join('\n'));

    expect(job.state.z).toEqual(3);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 0, 0, 0.5, 0, 0, 3]);
  });
});

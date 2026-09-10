import { test, expect } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { Parser } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { setAbsoluteExtrusion, setRelativeExtrusion } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('M83 switches E parameters to relative distances', () => {
  const command = new GCodeCommand(0, 'M83', 'm83', {});
  const job = new Job();

  setRelativeExtrusion(command, job);

  expect(job.state.relativeExtrusion).toBe(true);
});

test('M82 switches E parameters back to absolute positions', () => {
  const command = new GCodeCommand(0, 'M82', 'm82', {});
  const job = new Job();
  job.state.relativeExtrusion = true;

  setAbsoluteExtrusion(command, job);

  expect(job.state.relativeExtrusion).toBe(false);
});

test('the mode defaults to absolute, matching every major firmware', () => {
  expect(new Job().state.relativeExtrusion).toBe(false);
});

test('the extruder position follows the active mode through the registry', () => {
  const run = (lines: string[]): Job =>
    new Interpreter().execute(new Parser().parseGCode(lines.join('\n')).commands, new Job());

  // absolute: E is a position, so the file ends at the last announced E
  expect(run(['M82', 'G1 X10 E2', 'G1 X20 E5']).state.e).toEqual(5);
  // relative: E is a distance, so the positions accumulate
  expect(run(['M83', 'G1 X10 E2', 'G1 X20 E5']).state.e).toEqual(7);
});

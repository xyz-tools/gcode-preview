import { test, expect } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { home } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('G28 moves the state to the origin and marks it homed', () => {
  const command = new GCodeCommand('G28', 'g28', {});
  const job = new Job();
  job.state.x = 3;
  job.state.y = 4;
  expect(job.state.isHomed).toBe(false);

  home(command, job);

  expect(job.state.x).toEqual(0);
  expect(job.state.y).toEqual(0);
  expect(job.state.z).toEqual(0);
  expect(job.state.isHomed).toBe(true);
});

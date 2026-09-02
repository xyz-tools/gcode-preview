import { test, expect } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { selectTool } from '../../../interpreter/commands';
import { Job } from '../../../job';

test.each([0, 1, 2, 3, 4, 5, 6, 7])('T%i sets the tool to %i', (tool) => {
  const command = new GCodeCommand(`T${tool}`, `t${tool}`, {});
  const job = new Job();
  job.state.tool = 3;

  selectTool(command, job);

  expect(job.state.tool).toEqual(tool);
});

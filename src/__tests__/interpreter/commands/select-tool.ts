import { test, expect } from 'vitest';
import { cmd } from '../command-fixtures';
import { selectTool } from '../../../interpreter/commands';
import { Job } from '../../../job';

test.each([0, 1, 2, 3, 4, 5, 6, 7])('T%i sets the tool to %i', (tool) => {
  const command = cmd(`T${tool}`);
  const job = new Job();
  job.state.tool = 3;

  selectTool(command, job);

  expect(job.state.tool).toEqual(tool);
});

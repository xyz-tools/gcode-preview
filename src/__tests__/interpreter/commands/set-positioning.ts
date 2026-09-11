import { test, expect } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { setAbsolutePositioning, setRelativePositioning } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('G90 sets absolute positioning mode', () => {
  const command = new GCodeCommand('G90', 'g90', {});
  const job = new Job();
  job.state.positioning = 'relative';

  setAbsolutePositioning(command, job);

  expect(job.state.positioning).toEqual('absolute');
});

test('G91 sets relative positioning mode', () => {
  const command = new GCodeCommand('G91', 'g91', {});
  const job = new Job();

  setRelativePositioning(command, job);

  expect(job.state.positioning).toEqual('relative');
});

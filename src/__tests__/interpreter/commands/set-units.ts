import { test, expect } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { setInchUnits, setMillimeterUnits } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('G20 sets the units to inches', () => {
  const command = new GCodeCommand('G20', 'g20', {});
  const job = new Job();

  setInchUnits(command, job);

  expect(job.state.units).toEqual('in');
});

test('G21 sets the units to millimeters', () => {
  const command = new GCodeCommand('G21', 'g21', {});
  const job = new Job();

  setMillimeterUnits(command, job);

  expect(job.state.units).toEqual('mm');
});

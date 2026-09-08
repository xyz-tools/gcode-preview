import { test, expect } from 'vitest';
import { cmd } from '../command-fixtures';
import { setUnits } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('G20 sets the units to inches', () => {
  const job = new Job();

  setUnits(cmd('G20'), job);

  expect(job.state.units).toEqual('in');
});

test('G21 sets the units to millimeters', () => {
  const job = new Job();

  setUnits(cmd('G21'), job);

  expect(job.state.units).toEqual('mm');
});

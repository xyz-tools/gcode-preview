import { test, expect, describe } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { pause } from '../../../interpreter/commands';
import { Job } from '../../../job';

describe('pause', () => {
  test('M400 U1 starts the next print segment', () => {
    const command = new GCodeCommand('M400 U1', 'm400', { u: 1 });
    const job = new Job();

    pause(command, job);

    expect(job.state.segmentIndex).toEqual(1);
  });

  test('every pause starts another segment', () => {
    const command = new GCodeCommand('M400 U1', 'm400', { u: 1 });
    const job = new Job();

    pause(command, job);
    pause(command, job);
    pause(command, job);

    expect(job.state.segmentIndex).toEqual(3);
  });

  test('a bare M400 is a planner drain, not a pause, and keeps the segment', () => {
    const command = new GCodeCommand('M400', 'm400', {});
    const job = new Job();

    pause(command, job);

    expect(job.state.segmentIndex).toEqual(0);
  });

  test('a zero-millisecond pause still starts a segment', () => {
    const command = new GCodeCommand('M400 U0', 'm400', { u: 0 });
    const job = new Job();

    pause(command, job);

    expect(job.state.segmentIndex).toEqual(1);
  });
});

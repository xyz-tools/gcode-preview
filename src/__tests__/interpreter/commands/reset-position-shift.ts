import { test, expect, describe } from 'vitest';
import { Parser } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { Job } from '../../../job';

describe('resetPositionShift (G92.1)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('clears all workspace shifts without moving or resetting the extruder', () => {
    const job = run(['G28', 'G1 X10 Y20 Z30 E1', 'G92 X1 Y2 Z3 E4', 'G92.1'].join('\n'));

    expect(job.state.positionShift).toEqual({ x: 0, y: 0, z: 0, e: 0 });
    expect(job.resolvePosition()).toEqual({ x: 10, y: 20, z: 30 });
    expect(job.state.e).toEqual(1);
    expect(job.state.isHomed).toBe(true);
    expect(job.stats.points).toEqual(1);
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 20, 30]);
  });

  test('repeated resets preserve unknown positions and do not create paths', () => {
    const job = run(['G92 X1 Y2 Z3 E4', 'G92.1', 'G92.1'].join('\n'));

    expect(job.state.positionShift).toEqual({ x: 0, y: 0, z: 0, e: 0 });
    expect(job.state.x).toBeUndefined();
    expect(job.state.y).toBeUndefined();
    expect(job.state.z).toBeUndefined();
    expect(job.state.e).toEqual(0);
    expect(job.state.isHomed).toBe(false);
    expect(job.stats.points).toEqual(0);
    expect(job.paths).toEqual([]);
  });

  test.each([false, true])('following moves use unshifted coordinates (chunked: %s)', (chunked) => {
    const commands = new Parser().parseGCode(
      ['G28', 'G1 X10 Y10 E1', 'G92 X0 Y0', 'G1 X5 Y5 E1', 'G92.1', 'G1 X20 Y20 E1'].join('\n')
    ).commands;
    const interpreter = new Interpreter();
    const job = new Job();

    if (chunked) {
      interpreter.execute(commands.slice(0, 5), job);
      interpreter.execute(commands.slice(5), job);
    } else {
      interpreter.execute(commands, job);
    }

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 0, 15, 15, 0, 20, 20, 0]);
    expect(job.stats.points).toEqual(3);
  });

  test('following arcs use unshifted endpoints', () => {
    const job = run(['G28', 'G1 X10 Y10 E1', 'G92 X0 Y0', 'G92.1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    expect(job.resolvePosition()).toEqual({ x: 20, y: 10, z: 0 });
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices.slice(-3)).toEqual([20, 10, 0]);
  });

  test.each([false, true])('clears the E offset across relative extrusion (chunked: %s)', (chunked) => {
    const commands = new Parser().parseGCode(
      ['G1 X10 E5', 'G92 E2', 'G1 E-1', 'G92.1', 'G1 X20 E2'].join('\n')
    ).commands;
    const interpreter = new Interpreter();
    const job = new Job();

    if (chunked) {
      interpreter.execute(commands.slice(0, 3), job);
      expect(job.state.e).toEqual(4);
      expect(job.state.positionShift.e).toEqual(3);
      interpreter.execute(commands.slice(3), job);
    } else {
      interpreter.execute(commands, job);
    }

    expect(job.state.e).toEqual(6);
    expect(job.state.positionShift.e).toEqual(0);
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 0, 0, 20, 0, 0]);
    expect(job.stats.extrusionDistance).toEqual(7);
  });
});

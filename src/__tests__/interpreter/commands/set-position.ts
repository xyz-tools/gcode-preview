import { test, expect, describe } from 'vitest';
import { Parser, GCodeCommand } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { setPosition } from '../../../interpreter/commands';
import { Job } from '../../../job';

describe('setPosition (G92)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('gives the current position new coordinates without moving the printhead', () => {
    const command = new GCodeCommand('G92 X0 Y5 Z1 E2', 'g92', { x: 0, y: 5, z: 1, e: 2 });
    const job = new Job();
    job.state.x = 10;
    job.state.y = 20;
    job.state.z = 5;

    setPosition(command, job);

    // physical position is untouched; the shift maps logical -> physical
    expect(job.state.x).toEqual(10);
    expect(job.state.y).toEqual(20);
    expect(job.state.z).toEqual(5);
    expect(job.state.positionShift).toEqual({ x: 10, y: 15, z: 4 });
    expect(job.state.e).toEqual(2);
  });

  test('keeps the shift of the axes a partial G92 omits', () => {
    const command = new GCodeCommand('G92 Y5', 'g92', { y: 5 });
    const job = new Job();
    job.state.y = 7;
    job.state.e = 3;

    setPosition(command, job);

    expect(job.state.positionShift).toEqual({ x: 0, y: 2, z: 0 });
    expect(job.state.e).toEqual(3);
  });

  test('shifts Z when it is the only axis given', () => {
    const command = new GCodeCommand('G92 Z3', 'g92', { z: 3 });
    const job = new Job();
    job.state.z = 5;

    setPosition(command, job);

    expect(job.state.positionShift).toEqual({ x: 0, y: 0, z: 2 });
  });

  test('a bare G92 makes the current position the origin of every axis', () => {
    const command = new GCodeCommand('G92', 'g92', {});
    const job = new Job();
    job.state.x = 1;
    job.state.y = 2;
    job.state.z = 3;
    job.state.e = 4;

    setPosition(command, job);

    expect(job.state.positionShift).toEqual({ x: 1, y: 2, z: 3 });
    expect(job.state.e).toEqual(0);
  });

  test('a G92 with only non-axis words is not treated as a bare reset', () => {
    const command = new GCodeCommand('G92 F3000', 'g92', { f: 3000 });
    const job = new Job();
    job.state.x = 1;
    job.state.e = 4;

    setPosition(command, job);

    expect(job.state.positionShift).toEqual({ x: 0, y: 0, z: 0 });
    expect(job.state.e).toEqual(4);
  });

  test('an un-homed axis is assumed at the origin when computing the shift', () => {
    const command = new GCodeCommand('G92 X5', 'g92', { x: 5 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.positionShift).toEqual({ x: -5, y: 0, z: 0 });
    expect(job.state.x).toBeUndefined();
  });

  test('does not mark the axes as homed', () => {
    // As in Marlin, G92 trusts the given coordinates but does not home
    const command = new GCodeCommand('G92 X1 Y2 Z3', 'g92', { x: 1, y: 2, z: 3 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.isHomed).toBe(false);
  });

  test('the following moves continue in place instead of teleporting', () => {
    const job = run(['G28', 'G1 X10 Y10 E1', 'G92 X0 Y0', 'G1 X5 Y5 E1'].join('\n'));

    // The printhead never moved on G92, so the path is continuous and the
    // logical (5,5) target lands at the physical (15,15)
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 0, 15, 15, 0]);
  });

  test('a bare G92 mid-print rebases every following move on the current position', () => {
    const job = run(['G1 X10 Y10 E1', 'G92', 'G1 X5 E1'].join('\n'));

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 0, 15, 10, 0]);
  });

  test('an E-only G92 does not affect the geometry', () => {
    // Slicers emit G92 E0 on every layer; it must not fragment or shift paths
    const job = run(['G1 X10 E1', 'G92 E0', 'G1 X20 E1'].join('\n'));

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 0, 0, 20, 0, 0]);
    expect(job.state.e).toEqual(0);
  });

  test('a Z re-zero translates the following Z moves', () => {
    // The mach3 demo idiom: probe, re-zero Z, then lift by small logical amounts
    const job = run(['G0 Z2', 'G92 Z0', 'G0 Z0.5'].join('\n'));

    expect(job.state.z).toEqual(2.5);
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 0, 0, 2, 0, 0, 2.5]);
  });

  test('arc endpoints are translated by the shift', () => {
    const job = run(['G28', 'G1 X10 Y10 E1', 'G92 X0 Y0', 'G2 X0 Y10 I-10 J0 E1'].join('\n'));

    // logical endpoint (0,10) + shift (10,10) = physical (10,20)
    expect(job.state.x).toEqual(10);
    expect(job.state.y).toEqual(20);
    const { vertices } = job.paths[0];
    expect(vertices.slice(-3)).toEqual([10, 20, 0]);
  });

  test('a chunk boundary right after G92 produces the same paths as a single run', () => {
    const commands = new Parser().parseGCode(['G28', 'G1 X10 E1', 'G92 X0', 'G1 X5 E1'].join('\n')).commands;
    const interpreter = new Interpreter();
    const job = new Job();

    interpreter.execute(commands.slice(0, 3), job);
    interpreter.execute(commands.slice(3), job);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 0, 0, 15, 0, 0]);
  });
});

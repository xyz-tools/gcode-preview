import { test, expect, describe } from 'vitest';
import { Parser, GCodeCommand } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { setPosition } from '../../../interpreter/commands';
import { Job } from '../../../job';
import { PathType } from '../../../path';

describe('setPosition (G92)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('sets every given axis on the state', () => {
    const command = new GCodeCommand('G92 X10 Y20 Z5 E1', 'g92', { x: 10, y: 20, z: 5, e: 1 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.x).toEqual(10);
    expect(job.state.y).toEqual(20);
    expect(job.state.z).toEqual(5);
    expect(job.state.e).toEqual(1);
  });

  test('keeps the axes a partial G92 omits', () => {
    const command = new GCodeCommand('G92 Y5', 'g92', { y: 5 });
    const job = new Job();
    job.state.x = 1;
    job.state.z = 2;
    job.state.e = 3;

    setPosition(command, job);

    expect(job.state.x).toEqual(1);
    expect(job.state.y).toEqual(5);
    expect(job.state.z).toEqual(2);
    expect(job.state.e).toEqual(3);
  });

  test('sets Z when it is the only axis given', () => {
    const command = new GCodeCommand('G92 Z3', 'g92', { z: 3 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.z).toEqual(3);
  });

  test('resets every axis to zero when no axis is given', () => {
    const command = new GCodeCommand('G92', 'g92', {});
    const job = new Job();
    job.state.x = 1;
    job.state.y = 2;
    job.state.z = 3;
    job.state.e = 4;

    setPosition(command, job);

    expect(job.state.x).toEqual(0);
    expect(job.state.y).toEqual(0);
    expect(job.state.z).toEqual(0);
    expect(job.state.e).toEqual(0);
  });

  test('tracks the extrusion amount of an E-only G92', () => {
    const command = new GCodeCommand('G92 E5', 'g92', { e: 5 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.e).toEqual(5);
  });

  test('does not mark the axes as homed', () => {
    // As in Marlin, G92 trusts the given coordinates but does not home
    const command = new GCodeCommand('G92 X0 Y0 Z0', 'g92', { x: 0, y: 0, z: 0 });
    const job = new Job();

    setPosition(command, job);

    expect(job.state.isHomed).toBe(false);
  });

  test('is a no-op on paths when the job has none in progress', () => {
    const command = new GCodeCommand('G92 X1', 'g92', { x: 1 });
    const job = new Job();

    setPosition(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('the next move starts from the new position instead of drawing a teleport segment', () => {
    const job = run(['G28', 'G1 X10 Y10 E1', 'G92 X0 Y0', 'G1 X5 Y5 E1'].join('\n'));

    expect(job.paths.length).toEqual(2);
    expect(job.paths[1].travelType).toEqual(PathType.Extrusion);
    expect(job.paths[1].vertices).toEqual([0, 0, 0, 5, 5, 0]);
  });

  test('a bare G92 mid-print also reseeds the path at the origin', () => {
    const job = run(['G1 X10 Y10 E1', 'G92', 'G1 X5 E1'].join('\n'));

    expect(job.paths.length).toEqual(2);
    expect(job.paths[1].vertices).toEqual([0, 0, 0, 5, 0, 0]);
  });

  test('an E-only G92 does not break the path', () => {
    // Slicers emit G92 E0 on every layer; it must not fragment the geometry
    const job = run(['G1 X10 E1', 'G92 E0', 'G1 X20 E1'].join('\n'));

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices.length).toEqual(9);
    expect(job.state.e).toEqual(0);
  });
});

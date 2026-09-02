import { test, expect, describe } from 'vitest';
import { GCodeCommand } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { linearMove } from '../../../interpreter/commands';
import { Job } from '../../../job';
import { PathType } from '../../../path';

describe('linearMove (G0/G1)', () => {
  test('starts a path if the job has none, starting at the job current state', () => {
    const command = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const job = new Job();
    job.state.x = 3;
    job.state.y = 4;
    job.state.tool = 5;

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.vertices.length).toEqual(6);
    expect(job.inprogressPath?.vertices[0]).toEqual(3);
    expect(job.inprogressPath?.vertices[1]).toEqual(4);
    expect(job.inprogressPath?.vertices[2]).toEqual(0);
    expect(job.inprogressPath?.tool).toEqual(5);
  });

  test('continues the path if the job has one', () => {
    const command1 = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const command2 = new GCodeCommand('G0 X3 Y4', 'g0', { x: 3, y: 4 });
    const job = new Job();

    job.state.z = 5;
    linearMove(command1, job);

    linearMove(command2, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.vertices.length).toEqual(9);
    expect(job.inprogressPath?.vertices[6]).toEqual(command2.params.x);
    expect(job.inprogressPath?.vertices[7]).toEqual(command2.params.y);
    expect(job.inprogressPath?.vertices[8]).toEqual(job.state.z);
  });

  test("assigns the travel type if there's no extrusion", () => {
    const command = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });

  test("assigns the extrusion type if there's extrusion", () => {
    const command = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual('Extrusion');
  });

  test('will not result in a path when there is no movement (retraction)', () => {
    const command = new GCodeCommand('G0 E-2', 'g0', { e: -2 });
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
  });

  test('will not result in a path when there is no movement (deretraction)', () => {
    const command = new GCodeCommand('G0 E4', 'g0', { e: 4 });
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
  });

  test('keeps the current Y when a move omits it', () => {
    const command = new GCodeCommand('G0 X5', 'g0', { x: 5 });
    const job = new Job();
    job.state.y = 7;

    linearMove(command, job);

    expect(job.state.x).toEqual(5);
    expect(job.state.y).toEqual(7);
  });

  test('counts a bare feedrate change as a feedrate change, not a move', () => {
    const command = new GCodeCommand('G0 F3000', 'g0', { f: 3000 });
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.stats.feedrateChanges).toEqual(1);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('counts a zero-length move with no parameters as "other"', () => {
    const command = new GCodeCommand('G0', 'g0', {});
    const job = new Job();

    linearMove(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.stats.others).toEqual(1);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('starts a new path if the travel type changes from Travel to Extrusion', () => {
    const command1 = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const command2 = new GCodeCommand('G1 X3 Y4 E5', 'g1', { x: 3, y: 4, e: 5 });
    const interpreter = new Interpreter();
    const job = new Job();
    interpreter.execute([command1], job);

    linearMove(command2, job);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Extrusion);
  });

  test('starts a new path if the travel type changes from Extrusion to Travel', () => {
    const command1 = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const command2 = new GCodeCommand('G0 X3 Y4', 'g0', { x: 3, y: 4 });
    const interpreter = new Interpreter();
    const job = new Job();
    interpreter.execute([command1], job);

    linearMove(command2, job);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });
});

test('an un-homed state assumes the origin so a move can still render', () => {
  // Before G28 the position is unknown; we assume (0,0,0) to render best-effort
  // (see #361) while isHomed stays false so callers can tell it is assumed.
  const command = new GCodeCommand('G1 Y5 E1', 'g1', { y: 5, e: 1 });
  const job = new Job();

  linearMove(command, job);

  // X and Z were never given and never homed -> assumed origin in the geometry.
  expect(job.inprogressPath?.vertices.slice(0, 3)).toEqual([0, 0, 0]);
  expect(job.inprogressPath?.vertices.slice(3, 6)).toEqual([0, 5, 0]);
  expect(job.state.x).toBeUndefined();
  expect(job.state.z).toBeUndefined();
  expect(job.state.isHomed).toBe(false);
});

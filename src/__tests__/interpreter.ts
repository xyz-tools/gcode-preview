import { test, expect, describe } from 'vitest';
import { GCodeCommand } from '../gcode-parser';
import { Interpreter } from '../interpreter';
import { Job } from '../job';
import { PathType } from '../path';

describe('.execute', () => {
  test('returns a stateful job', () => {
    const command = new GCodeCommand('G0 X1 Y2 Z3', 'g0', { x: 1, y: 2, z: 3 });
    const interpreter = new Interpreter();

    const result = interpreter.execute([command]);

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Job);
    expect(result.state.x).toEqual(1);
    expect(result.state.y).toEqual(2);
    expect(result.state.z).toEqual(3);
  });

  test('ignores unknown commands', () => {
    const command = new GCodeCommand('G42', 'g42', {});
    const interpreter = new Interpreter();

    const result = interpreter.execute([command]);

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Job);
    expect(result.state.x).toEqual(0);
    expect(result.state.y).toEqual(0);
    expect(result.state.z).toEqual(0);
  });

  test('runs multiple commands', () => {
    const command1 = new GCodeCommand('G0 X1 Y2 Z3', 'g0', { x: 1, y: 2, z: 3 });
    const command2 = new GCodeCommand('G0 X4 Y5 Z6', 'g0', { x: 4, y: 5, z: 6 });
    const interpreter = new Interpreter();

    const result = interpreter.execute([command1, command2, command1, command2]);

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Job);
    expect(result.state.x).toEqual(4);
    expect(result.state.y).toEqual(5);
    expect(result.state.z).toEqual(6);
  });

  test('runs on an existing job', () => {
    const job = new Job();
    const command = new GCodeCommand('G0 X1 Y2 Z3', 'g0', { x: 1, y: 2, z: 3 });
    const interpreter = new Interpreter();

    const result = interpreter.execute([command], job);

    expect(result).toEqual(job);
    expect(result.state.x).toEqual(1);
    expect(result.state.y).toEqual(2);
    expect(result.state.z).toEqual(3);
  });

  test('finishes the current path at the end of the job', () => {
    const job = new Job();
    const command = new GCodeCommand('G0 X1 Y2 Z3', 'g0', { x: 1, y: 2, z: 3 });
    const interpreter = new Interpreter();
    interpreter.execute([command], job);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('resumes the current path when doing incremental execution', () => {
    const job = new Job();
    const command1 = new GCodeCommand('G0 X1 Y2 Z3', 'g0', { x: 1, y: 2, z: 3 });
    const command2 = new GCodeCommand('G0 X4 Y5 Z6', 'g0', { x: 4, y: 5, z: 6 });
    const interpreter = new Interpreter();

    interpreter.execute([command1], job);
    interpreter.execute([command2], job);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices.length).toEqual(9);
    expect(job.paths[0].vertices[6]).toEqual(command2.params.x);
    expect(job.paths[0].vertices[7]).toEqual(command2.params.y);
    expect(job.paths[0].vertices[8]).toEqual(command2.params.z);
  });
});

describe('.g0', () => {
  test('starts a path if the job has none, starting at the job current state', () => {
    const command = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const interpreter = new Interpreter();
    const job = new Job();
    job.state.x = 3;
    job.state.y = 4;
    job.state.tool = 5;

    interpreter.g0(command, job);

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
    const interpreter = new Interpreter();
    const job = new Job();

    job.state.z = 5;
    interpreter.g0(command1, job);

    interpreter.g0(command2, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.vertices.length).toEqual(9);
    expect(job.inprogressPath?.vertices[6]).toEqual(command2.params.x);
    expect(job.inprogressPath?.vertices[7]).toEqual(command2.params.y);
    expect(job.inprogressPath?.vertices[8]).toEqual(job.state.z);
  });

  test("assigns the travel type if there's no extrusion", () => {
    const command = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const interpreter = new Interpreter();
    const job = new Job();

    interpreter.g0(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });

  test("assigns the extrusion type if there's extrusion", () => {
    const command = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const interpreter = new Interpreter();
    const job = new Job();

    interpreter.g0(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual('Extrusion');
  });

  test('assigns the travel type if the extrusion is a retraction', () => {
    const command = new GCodeCommand('G0 E-2', 'g0', { e: -2 });
    const interpreter = new Interpreter();
    const job = new Job();

    interpreter.g0(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual('Travel');
  });

  test('assigns the travel type if the extrusion is a retraction', () => {
    const command = new GCodeCommand('G0 E-2', 'g0', { e: -2 });
    const interpreter = new Interpreter();
    const job = new Job();

    interpreter.g0(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual('Travel');
  });

  test('starts a new path if the travel type changes from Travel to Extrusion', () => {
    const command1 = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const command2 = new GCodeCommand('G1 X3 Y4 E5', 'g1', { x: 3, y: 4, e: 5 });
    const interpreter = new Interpreter();
    const job = new Job();
    interpreter.execute([command1], job);

    interpreter.g0(command2, job);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Extrusion);
  });

  test('starts a new path if the travel type changes from Extrusion to Travel', () => {
    const command1 = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const command2 = new GCodeCommand('G0 X3 Y4', 'g0', { x: 3, y: 4 });
    const interpreter = new Interpreter();
    const job = new Job();
    interpreter.execute([command1], job);

    interpreter.g0(command2, job);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });

  test('.G1 is an alias to .G0', () => {
    const interpreter = new Interpreter();

    expect(interpreter.g1).toEqual(interpreter.g0);
  });
});

test('.G20 sets the units to inches', () => {
  const command = new GCodeCommand('G20', 'g20', {});
  const interpreter = new Interpreter();
  const job = new Job();

  interpreter.g20(command, job);

  expect(job.state.units).toEqual('in');
});

test('.G21 sets the units to millimeters', () => {
  const command = new GCodeCommand('G21', 'g21', {});
  const interpreter = new Interpreter();
  const job = new Job();

  interpreter.g21(command, job);

  expect(job.state.units).toEqual('mm');
});

test('.g28 moves the state to the origin', () => {
  const command = new GCodeCommand('G28', 'g28', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.x = 3;
  job.state.y = 4;

  interpreter.g28(command, job);

  expect(job.state.x).toEqual(0);
  expect(job.state.y).toEqual(0);
  expect(job.state.z).toEqual(0);
});

test('.t0 sets the tool to 0', () => {
  const command = new GCodeCommand('T0', 't0', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t0(command, job);

  expect(job.state.tool).toEqual(0);
});

test('.t1 sets the tool to 1', () => {
  const command = new GCodeCommand('T1', 't1', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t1(command, job);

  expect(job.state.tool).toEqual(1);
});

test('.t2 sets the tool to 2', () => {
  const command = new GCodeCommand('T2', 't2', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t2(command, job);

  expect(job.state.tool).toEqual(2);
});

test('.t3 sets the tool to 3', () => {
  const command = new GCodeCommand('T3', 't3', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t3(command, job);

  expect(job.state.tool).toEqual(3);
});

test('.t4 sets the tool to 4', () => {
  const command = new GCodeCommand('T4', 't4', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t4(command, job);

  expect(job.state.tool).toEqual(4);
});

test('.t5 sets the tool to 5', () => {
  const command = new GCodeCommand('T5', 't5', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t5(command, job);

  expect(job.state.tool).toEqual(5);
});

test('.t6 sets the tool to 6', () => {
  const command = new GCodeCommand('T6', 't6', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t6(command, job);

  expect(job.state.tool).toEqual(6);
});

test('.t7 sets the tool to 7', () => {
  const command = new GCodeCommand('T7', 't7', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  interpreter.t7(command, job);

  expect(job.state.tool).toEqual(7);
});

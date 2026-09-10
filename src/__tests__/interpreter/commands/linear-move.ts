import { test, expect, describe } from 'vitest';
import { GCodeCommand, Parser } from '../../../parser/gcode-parser';
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

  test('tracks the extruder position of moves and of zero-length retractions', () => {
    const job = new Job();
    job.state.relativeExtrusion = false;

    // absolute mode (M82): E parameters are positions
    linearMove(new GCodeCommand('G1 X10 E2', 'g1', { x: 10, e: 2 }), job);
    expect(job.state.e).toEqual(2);

    // a zero-length prime still moves the extruder; losing it here would
    // misattribute the difference to the next extruding move
    linearMove(new GCodeCommand('G1 E3', 'g1', { e: 3 }), job);
    expect(job.state.e).toEqual(3);

    linearMove(new GCodeCommand('G1 X20 E4', 'g1', { x: 20, e: 4 }), job);
    expect(job.state.e).toEqual(4);
  });

  test('accumulates the extruder position in relative mode', () => {
    const job = new Job();
    job.state.relativeExtrusion = true;

    linearMove(new GCodeCommand('G1 X10 E2', 'g1', { x: 10, e: 2 }), job);
    linearMove(new GCodeCommand('G1 X20 E3', 'g1', { x: 20, e: 3 }), job);

    expect(job.state.e).toEqual(5);
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

  test('classifies an absolute-mode wipe as travel even though its E stays positive', () => {
    // A wipe retracts while moving in X/Y: the E parameter is still a positive
    // absolute position, but it is lower than the previous one, so no material
    // is laid down. Classifying on the raw parameter drew a bead across the model.
    const job = new Job();
    const interpreter = new Interpreter();
    interpreter.execute(new Parser().parseGCode(['M82', 'G1 X10 Y10 E5'].join('\n')).commands, job);

    linearMove(new GCodeCommand('G1 X20 Y20 E2.5', 'g1', { x: 20, y: 20, e: 2.5 }), job);

    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
    expect(job.state.e).toEqual(2.5);
  });

  test('counts only the filament an absolute-mode move actually extrudes', () => {
    const job = new Job();
    job.state.relativeExtrusion = false;

    linearMove(new GCodeCommand('G1 X10 E2', 'g1', { x: 10, e: 2 }), job);
    linearMove(new GCodeCommand('G1 X20 E5', 'g1', { x: 20, e: 5 }), job);

    // 2 then 3, not the raw parameters 2 and 5
    expect(job.stats.extrusionDistance).toEqual(5);
  });

  test('in relative mode every positive parameter still extrudes', () => {
    const job = new Job();
    job.state.relativeExtrusion = true;

    linearMove(new GCodeCommand('G1 X10 E2', 'g1', { x: 10, e: 2 }), job);
    linearMove(new GCodeCommand('G1 X20 E2', 'g1', { x: 20, e: 2 }), job);

    // the parameter is the extruded length itself, so a repeated value is a
    // second extrusion rather than the zero step it would be in absolute mode
    expect(job.inprogressPath?.travelType).toEqual(PathType.Extrusion);
    expect(job.stats.extrusionDistance).toEqual(4);
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

describe('filament consumption', () => {
  const run = (lines: string[], chunkSize = lines.length) => {
    const parser = new Parser();
    const interpreter = new Interpreter();
    const job = new Job();
    for (let i = 0; i < lines.length; i += chunkSize) {
      interpreter.execute(parser.parseGCode(lines.slice(i, i + chunkSize)).commands, job);
    }
    return job;
  };

  test('counts an E-only purge, which moves no axis at all', () => {
    expect(run(['M83', 'G1 E10']).stats.extrusionDistance).toEqual(10);
  });

  test('does not count recovery during XYZ movement as new filament', () => {
    const job = run(['M83', 'G1 X0 Y0 Z0', 'G1 X10 E10', 'G1 E-1', 'G1 X20 E1']);

    // the last move only gives back the retracted millimetre
    expect(job.stats.extrusionDistance).toEqual(10);
    expect(job.paths.at(-1)?.travelType).toEqual(PathType.Extrusion);
  });

  describe.each(['M82', 'M83'])('%s', (mode) => {
    const absolute = mode === 'M82';

    test.each(['G1', 'G1 X20'])('partial recovery and excess via "%s" count only the excess', (recovery) => {
      const job = run([
        mode,
        'G28',
        'G1 X10 E10',
        `G1 E${absolute ? 8 : -2}`,
        `G1 E${absolute ? 9 : 1}`,
        'G92 E0',
        `${recovery} E3`,
        'G1 X30',
        `G1 E${absolute ? 2 : -1}`
      ]);

      // 10 extruded, 2 retracted, then 1 + 3 primed back: 2 repay, 2 are new
      expect(job.stats.extrusionDistance).toEqual(12);
    });

    test.each(['G1', 'G1 X20'])('equal recovery via "%s" adds nothing', (recovery) => {
      const job = run([mode, 'G28', 'G1 X10 E10', `G1 X15 E${absolute ? 8 : -2}`, `${recovery} E${absolute ? 10 : 2}`]);

      expect(job.stats.extrusionDistance).toEqual(10);
    });
  });

  test('accounting is unaffected by how the commands are split across execute() calls', () => {
    // The outstanding retraction lives on the job, so a retract in one chunk is
    // still repaid by a prime that arrives in the next one.
    const lines = ['M83', 'G28', 'G1 X10 E10', 'G1 E-2', 'G1 E1', 'G92 E0', 'G1 E3', 'G1 X30', 'G1 E-1'];
    const oneshot = run(lines);

    for (let size = 1; size < lines.length; size++) {
      const chunked = run(lines, size);

      expect(chunked.stats).toEqual(oneshot.stats);
      expect(chunked.paths.map((path) => path.vertices)).toEqual(oneshot.paths.map((path) => path.vertices));
    }
  });
});

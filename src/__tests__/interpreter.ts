import { test, expect, describe } from 'vitest';
import { GCodeCommand, Parser } from '../parser/gcode-parser';
import { Interpreter, handlers } from '../interpreter';
import { linearMove } from '../interpreter/commands/linear-move';
import { setInchUnits, setMillimeterUnits } from '../interpreter/commands/set-units';
import { home } from '../interpreter/commands/home';
import { selectTool } from '../interpreter/commands/select-tool';
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

  test('skips a command whose gcode is undefined', () => {
    // A command with no gcode at all (guarded by `command.gcode !== undefined`).
    const command = new GCodeCommand('', undefined as unknown as string, {});
    const interpreter = new Interpreter();

    const result = interpreter.execute([command]);

    expect(result.paths.length).toEqual(0);
    // Nothing ran, so the axes are still un-homed and the position is unknown.
    expect(result.state.x).toBeUndefined();
    expect(result.state.isHomed).toBe(false);
  });

  test('ignores unknown commands', () => {
    const command = new GCodeCommand('G42', 'g42', {});
    const interpreter = new Interpreter();

    const result = interpreter.execute([command]);

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Job);
    // An unknown command leaves the axes un-homed, so the position stays unknown.
    expect(result.state.x).toBeUndefined();
    expect(result.state.y).toBeUndefined();
    expect(result.state.z).toBeUndefined();
    expect(result.state.isHomed).toBe(false);
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

describe('linearMove (G0/G1)', () => {
  test('starts a path if the job has none, starting at the job current state', () => {
    const command = new GCodeCommand('G0 X1 Y2', 'g0', { x: 1, y: 2 });
    const interpreter = new Interpreter();
    const job = new Job();
    job.state.x = 3;
    job.state.y = 4;
    job.state.tool = 5;

    linearMove(command, job, interpreter);

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
    linearMove(command1, job, interpreter);

    linearMove(command2, job, interpreter);

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

    linearMove(command, job, interpreter);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });

  test("assigns the extrusion type if there's extrusion", () => {
    const command = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const interpreter = new Interpreter();
    const job = new Job();

    linearMove(command, job, interpreter);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath?.travelType).toEqual('Extrusion');
  });

  test('will not result in a path when there is no movement (retraction)', () => {
    const command = new GCodeCommand('G0 E-2', 'g0', { e: -2 });
    const interpreter = new Interpreter();
    const job = new Job();

    linearMove(command, job, interpreter);

    expect(job.paths.length).toEqual(0);
  });

  test('will not result in a path when there is no movement (deretraction)', () => {
    const command = new GCodeCommand('G0 E4', 'g0', { e: 4 });
    const interpreter = new Interpreter();
    const job = new Job();

    linearMove(command, job, interpreter);

    expect(job.paths.length).toEqual(0);
  });

  test('keeps the current Y when a move omits it', () => {
    const command = new GCodeCommand('G0 X5', 'g0', { x: 5 });
    const interpreter = new Interpreter();
    const job = new Job();
    job.state.y = 7;

    linearMove(command, job, interpreter);

    expect(job.state.x).toEqual(5);
    expect(job.state.y).toEqual(7);
  });

  test('counts a bare feedrate change as a feedrate change, not a move', () => {
    const command = new GCodeCommand('G0 F3000', 'g0', { f: 3000 });
    const interpreter = new Interpreter();
    const job = new Job();

    linearMove(command, job, interpreter);

    expect(job.paths.length).toEqual(0);
    expect(job.stats.feedrateChanges).toEqual(1);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('counts a zero-length move with no parameters as "other"', () => {
    const command = new GCodeCommand('G0', 'g0', {});
    const interpreter = new Interpreter();
    const job = new Job();

    linearMove(command, job, interpreter);

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

    linearMove(command2, job, interpreter);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Extrusion);
  });

  test('starts a new path if the travel type changes from Extrusion to Travel', () => {
    const command1 = new GCodeCommand('G1 X1 Y2 E3', 'g1', { x: 1, y: 2, e: 3 });
    const command2 = new GCodeCommand('G0 X3 Y4', 'g0', { x: 3, y: 4 });
    const interpreter = new Interpreter();
    const job = new Job();
    interpreter.execute([command1], job);

    linearMove(command2, job, interpreter);

    expect(job.paths.length).toEqual(1);
    expect(job.inprogressPath?.travelType).toEqual(PathType.Travel);
  });

  test('G1 is handled by the same handler as G0', () => {
    expect(handlers.get('g1')).toBe(handlers.get('g0'));
  });

  test('G3 is handled by the same handler as G2', () => {
    expect(handlers.get('g3')).toBe(handlers.get('g2'));
  });
});

test('G20 sets the units to inches', () => {
  const command = new GCodeCommand('G20', 'g20', {});
  const interpreter = new Interpreter();
  const job = new Job();

  setInchUnits(command, job, interpreter);

  expect(job.state.units).toEqual('in');
});

test('G21 sets the units to millimeters', () => {
  const command = new GCodeCommand('G21', 'g21', {});
  const interpreter = new Interpreter();
  const job = new Job();

  setMillimeterUnits(command, job, interpreter);

  expect(job.state.units).toEqual('mm');
});

test('G28 moves the state to the origin and marks it homed', () => {
  const command = new GCodeCommand('G28', 'g28', {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.x = 3;
  job.state.y = 4;
  expect(job.state.isHomed).toBe(false);

  home(command, job, interpreter);

  expect(job.state.x).toEqual(0);
  expect(job.state.y).toEqual(0);
  expect(job.state.z).toEqual(0);
  expect(job.state.isHomed).toBe(true);
});

test('an un-homed state assumes the origin so a move can still render', () => {
  // Before G28 the position is unknown; we assume (0,0,0) to render best-effort
  // (see #361) while isHomed stays false so callers can tell it is assumed.
  const command = new GCodeCommand('G1 Y5 E1', 'g1', { y: 5, e: 1 });
  const interpreter = new Interpreter();
  const job = new Job();

  linearMove(command, job, interpreter);

  // X and Z were never given and never homed -> assumed origin in the geometry.
  expect(job.inprogressPath?.vertices.slice(0, 3)).toEqual([0, 0, 0]);
  expect(job.inprogressPath?.vertices.slice(3, 6)).toEqual([0, 5, 0]);
  expect(job.state.x).toBeUndefined();
  expect(job.state.z).toBeUndefined();
  expect(job.state.isHomed).toBe(false);
});

test.each([0, 1, 2, 3, 4, 5, 6, 7])('T%i sets the tool to %i', (tool) => {
  const command = new GCodeCommand(`T${tool}`, `t${tool}`, {});
  const interpreter = new Interpreter();
  const job = new Job();
  job.state.tool = 3;

  selectTool(command, job, interpreter);

  expect(job.state.tool).toEqual(tool);
});

describe('malformed coordinates through the whole pipeline', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);
  const allVertices = (job: Job) => job.paths.flatMap((path) => path.vertices);
  // The vertices the final command contributed, without the lead-in move or the
  // implicit start point at the origin.
  const zsOf = (vertices: number[]) => vertices.filter((_, index) => index % 3 === 2);
  const tailVertices = (setup: string[], last: string) => {
    const before = allVertices(run(setup.join('\n'))).length;
    return allVertices(run([...setup, last].join('\n'))).slice(before);
  };

  test('a malformed coordinate leaves the job state finite', () => {
    // Before validation at the parser boundary, Xabc parsed to NaN and `x ?? state.x`
    // kept it (?? only catches null/undefined), poisoning the state from there on.
    const job = run(['G1 X10 Y10 Z1 E1', 'G1 Xabc Y20 E1'].join('\n'));

    expect(job.state.x).toEqual(10);
    expect(job.state.y).toEqual(20);
    expect(Number.isFinite(job.state.x)).toBe(true);
  });

  test('a malformed coordinate does not poison the bounding box', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G1 Xabc Y20 E1', 'G1 X30 Y30 E1'].join('\n'));

    expect(job.boundingBox.isValid).toBe(true);
    expect(job.boundingBox.corners).toEqual({
      min: expect.objectContaining({ x: 10, y: 10, z: 1 }),
      max: expect.objectContaining({ x: 30, y: 30, z: 1 })
    });
  });

  test('an overflowing coordinate does not stretch the bounding box to Infinity', () => {
    const huge = '1' + '0'.repeat(400);
    const job = run(['G1 X10 Y10 Z1 E1', `G1 X${huge} E1`, 'G1 X30 Y30 E1'].join('\n'));

    expect(job.boundingBox.size).toEqual(expect.objectContaining({ x: 20, y: 20, z: 0 }));
  });

  test('an arc emits only finite segment points', () => {
    // A half circle of radius 5 -- enough arc length to go through the segment loop.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.length).toBeGreaterThan(3 * 3);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
  });

  test('an arc ending on X0 or Y0 moves there instead of keeping the previous position', () => {
    // g2 used `x || state.x`, so a legitimate 0 endpoint was falsy and silently
    // discarded. This is ordinary valid gcode, not a malformed-input case.
    const job = run(['G1 X10 Y10 Z5 E1', 'G2 X0 Y0 I-5 J-5 E1'].join('\n'));

    expect(job.state.x).toEqual(0);
    expect(job.state.y).toEqual(0);
  });

  test('an arc ending on Z0 moves there instead of keeping the previous height', () => {
    const job = run(['G1 X10 Y10 Z5 E1', 'G2 X20 Y10 Z0 I5 J0 E1'].join('\n'));

    expect(job.state.z).toEqual(0);
  });

  test('a helical arc interpolates Z towards the target, not away from it', () => {
    // zDist was current - target, so a climb from Z1 to Z3 descended to Z-0.97 across
    // its 31 intermediate points and only reached Z3 at the endpoint.
    const zs = zsOf(tailVertices(['G1 X10 Y10 Z1 E1'], 'G2 X20 Y10 Z3 I5 J0 E1'));

    expect(zs.length).toBeGreaterThan(2);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...zs)).toBeLessThanOrEqual(3);
    // and it should actually climb, not sit flat at the start height
    expect(Math.max(...zs)).toBeGreaterThan(1);
  });

  test('an arc descending to Z0 spreads the drop across its segments', () => {
    // `z || state.z` made a Z0 target fall back to the current height, so zDist was 0
    // and every intermediate point sat flat at Z5 before the endpoint snapped to Z0.
    const zs = zsOf(tailVertices(['G1 X10 Y10 Z5 E1'], 'G2 X20 Y10 Z0 I5 J0 E1'));

    expect(zs.some((value) => value > 0 && value < 5)).toBe(true);
    expect(zs.every((value) => Number.isFinite(value))).toBe(true);
  });

  test('a malformed Z on an arc leaves the intermediate points finite', () => {
    // `??` propagates NaN where `||` absorbed it, so this relies on the parser
    // dropping the param entirely. Guards the coupling between the two changes.
    const zs = zsOf(tailVertices(['G1 X10 Y10 Z5 E1'], 'G2 X20 Y10 Zabc I5 J0 E1'));

    expect(zs.every((value) => Number.isFinite(value))).toBe(true);
    expect(zs.every((value) => value === 5)).toBe(true);
  });

  test('a degenerate R-mode whole circle emits the endpoint and no arc', () => {
    // start === end in R mode leaves dSquared === 0, so the centre is undefined.
    // The arc is skipped deliberately rather than rendered from NaN centres.
    const arcVertices = tailVertices(['G1 X10 Y10 Z1 E1'], 'G2 X10 Y10 R5 E1');

    expect(arcVertices).toEqual([10, 10, 1]); // the endpoint only, no intermediate points
  });

  test('a degenerate R-mode whole circle terminates and emits only finite points', () => {
    // Every param here is finite, but deltaX/deltaY are 0 so the R block divides by
    // dSquared === 0: hDivD is Infinity and i/j come out NaN.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X10 Y10 R5 E1'].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
  });

  test('arc offsets that overflow the radius do not blow up the vertex buffer', () => {
    // I/J near Number.MAX_VALUE make arcRadius Infinity. On a whole circle totalArc is
    // 2*PI rather than 0, so totalSegments is Infinity instead of NaN and
    // `moveIdx < totalSegments - 1` never becomes false. Without the guard the loop
    // pushes vertices until the array hits its length limit and throws
    // `RangeError: Invalid array length`, aborting execute() and losing the whole job.
    const huge = '1' + '0'.repeat(308);
    const job = run(['G1 X10 Y10 Z1 E1', `G2 X10 Y10 I${huge} J${huge} E1`].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
  });

  test('an arc with a malformed endpoint still produces only finite points', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 Xabc Y20 I5 J0 E1'].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
    expect(job.boundingBox.corners?.min.x).not.toBeNaN();
  });
});

describe('arcMove (G2/G3)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('a retracting arc is a travel move, matching G0/G1 (negative E)', () => {
    // g0/g1 classify negative E (a retraction) as Travel via `e > 0`. g2/g3 used the
    // looser `e ?`, so a negative E arc was misclassified as Extrusion: it rendered as
    // deposited material and, worse, stretched the bounding box out along the arc even
    // though nothing was extruded.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E-1'].join('\n'));

    // The arc must not be lumped onto the preceding extrusion path.
    const lastPath = job.paths[job.paths.length - 1];
    expect(lastPath.travelType).toEqual(PathType.Travel);

    // A travel move never grows the print bounds, so the box stays where the
    // extrusion left it instead of stretching to the arc's far side (x = 20).
    expect(job.boundingBox.corners?.max.x).toEqual(10);
  });

  test('a positive-E arc still extrudes and grows the bounding box', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    const lastPath = job.paths[job.paths.length - 1];
    expect(lastPath.travelType).toEqual(PathType.Extrusion);
    expect(job.boundingBox.corners?.max.x).toEqual(20);
  });

  test('keeps the current Y when an arc omits it', () => {
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 I5 J0 E1'].join('\n'));

    expect(job.state.y).toEqual(10);
    expect(job.paths.flatMap((path) => path.vertices).every((value) => Number.isFinite(value))).toBe(true);
  });

  test('R mode computes a centre and renders a curved arc', () => {
    // R mode (radius instead of I/J offsets) has to solve for the centre. Exercise the
    // non-degenerate branch with r larger than half the chord so the curve bulges.
    const job = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 R10 E1'].join('\n'));

    const arcPath = job.paths[job.paths.length - 1];
    const points = arcPath.path();
    // more than just start + endpoint: real intermediate segments were emitted
    expect(points.length).toBeGreaterThan(2);
    expect(arcPath.vertices.every((value) => Number.isFinite(value))).toBe(true);
    // ends exactly on the requested endpoint
    expect(points[points.length - 1]).toMatchObject({ x: 20, y: 10 });
  });

  test('R mode counter-clockwise (G3) selects the opposite centre', () => {
    // g3 with a positive radius flips the sign of the centre offset. Both arcs share
    // endpoints but bow to opposite sides, so their mid-point Y differs.
    const cw = run(['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 R10 E1'].join('\n'));
    const ccw = run(['G1 X10 Y10 Z1 E1', 'G3 X20 Y10 R10 E1'].join('\n'));

    const midY = (job: Job) => {
      const pts = job.paths[job.paths.length - 1].path();
      return pts[Math.floor(pts.length / 2)].y;
    };

    expect(midY(cw)).not.toBeCloseTo(midY(ccw));
    // clockwise from (10,10) to (20,10) bows above the chord, ccw bows below
    expect(midY(cw)).toBeGreaterThan(10);
    expect(midY(ccw)).toBeLessThan(10);
  });

  test('arcs in inch units are segmented more finely than in mm', () => {
    // Inch arcs multiply the segment count so the on-screen curve stays smooth despite
    // the much smaller numeric radius.
    const mm = run(['G21', 'G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));
    const inch = run(['G20', 'G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

    const segCount = (job: Job) => job.paths[job.paths.length - 1].path().length;
    expect(segCount(inch)).toBeGreaterThan(segCount(mm));
  });

  test('a tiny arc still emits at least the endpoint (segment count clamped to 1)', () => {
    // arcRadius * totalArc / 0.5 drops below 1 for a sub-millimetre arc; the count is
    // clamped to 1 so the endpoint is always emitted and the loop adds no interior points.
    // A travel lead-in keeps the extrusion arc on its own path so we count only its points.
    const job = run(['G0 X10 Y10 Z1', 'G2 X10.01 Y10 I0.005 J0 E1'].join('\n'));

    const arcPath = job.paths[job.paths.length - 1];
    const points = arcPath.path();
    // start-of-path point + endpoint only, no interior segments
    expect(points.length).toEqual(2);
    expect(points[points.length - 1]).toMatchObject({ x: 10.01, y: 10 });
  });
});

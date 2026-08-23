import { test, expect, describe } from 'vitest';
import { GCodeCommand, Parser } from '../parser/gcode-parser';
import { Interpreter, handlers } from '../interpreter';
import { Job } from '../job';

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

describe('handler registry', () => {
  test('G1 is handled by the same handler as G0', () => {
    expect(handlers.get('g1')).toBe(handlers.get('g0'));
  });

  test('G3 is handled by the same handler as G2', () => {
    expect(handlers.get('g3')).toBe(handlers.get('g2'));
  });
});

describe('malformed coordinates through the whole pipeline', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);
  const allVertices = (job: Job) => job.paths.flatMap((path) => path.vertices);
  // The vertices the final command contributed, without the lead-in move or the
  // implicit start point at the origin.
  const ysOf = (vertices: number[]) => vertices.filter((_, index) => index % 3 === 1);
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

  test('a G3 arc sweeps counter-clockwise where G2 sweeps clockwise', () => {
    // The same half circle around (15,10), from west to east, in both directions.
    // Viewed from above, G2 (clockwise) passes north of the center and G3
    // (counter-clockwise) south. Also guards the g3 registry wiring end to end:
    // without it G3 is silently ignored and contributes no intermediate points,
    // and the shared handler must still flip direction per gcode.
    const g2Ys = ysOf(tailVertices(['G1 X10 Y10 Z1 E1'], 'G2 X20 Y10 I5 J0 E1'));
    const g3Ys = ysOf(tailVertices(['G1 X10 Y10 Z1 E1'], 'G3 X20 Y10 I5 J0 E1'));

    expect(g3Ys.length).toBeGreaterThan(2);
    expect(Math.max(...g2Ys)).toBeGreaterThan(14);
    expect(Math.min(...g2Ys)).toBeGreaterThanOrEqual(10);
    expect(Math.min(...g3Ys)).toBeLessThan(6);
    expect(Math.max(...g3Ys)).toBeLessThanOrEqual(10);
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

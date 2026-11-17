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

  test('switches positioning modes in parsed G-code', () => {
    const parser = new Parser();
    const interpreter = new Interpreter();
    const { commands } = parser.parseGCode(['G0 X10 Y10 Z10', 'G91', 'G1 X2 Y-3 Z1', 'G90', 'G1 X4 Y5 Z6']);

    const result = interpreter.execute(commands);

    expect(result.state.x).toEqual(4);
    expect(result.state.y).toEqual(5);
    expect(result.state.z).toEqual(6);
    expect(result.state.positioning).toEqual('absolute');
    expect(result.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 10, 12, 7, 11, 4, 5, 6]);
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

describe('positioning modes through the whole pipeline', () => {
  const run = (lines: string[]) => new Interpreter().execute(new Parser().parseGCode(lines).commands);
  const vertices = (job: Job) => job.paths.flatMap((path) => path.vertices);

  test.each(['G0 X1 Y0 Z0', 'G1 X1 Y0 Z0', 'G2 X1 Y0 I0.5 J0', 'G3 X1 Y0 R0.5', 'G31 X1 Y0 Z0'])(
    'relative inch move %s composes with workspace shifts and a switch back to millimeters',
    (command) => {
      const job = run(['G28', 'G0 X25.4 Y50.8 Z25.4', 'G92 X0 Y0 Z0', 'G20', 'G91', command, 'G21', 'G1 X1']);

      expect(job.state.x).toBeCloseTo(51.8);
      expect(job.state.y).toBeCloseTo(50.8);
      expect(job.state.z).toBeCloseTo(25.4);
      expect(vertices(job).slice(-6, -3)).toEqual([50.8, 50.8, 25.4]);
      expect(vertices(job).every(Number.isFinite)).toBe(true);
    }
  );

  test.each(['G0', 'G1', 'G2', 'G3'])('%s assumes zero for supplied unknown axes in G91', (command) => {
    const job = run(['G91', `${command} X10 Y0 Z5 I5 J0`]);

    expect([job.state.x, job.state.y, job.state.z]).toEqual([10, 0, 5]);
    expect(job.state.isHomed).toBe(false);
    expect(vertices(job).slice(0, 3)).toEqual([0, 0, 0]);
    expect(vertices(job).slice(-3)).toEqual([10, 0, 5]);
    expect(vertices(job).every(Number.isFinite)).toBe(true);
  });

  test.each(['G0', 'G1', 'G2', 'G3'])('%s preserves omitted unknown axes in G91', (command) => {
    const job = run(['G91', `${command} X10 I5 J0`]);

    expect(job.state.x).toEqual(10);
    expect(job.state.y).toBeUndefined();
    expect(job.state.z).toBeUndefined();
    expect(job.state.isHomed).toBe(false);
    expect(vertices(job).slice(-3)).toEqual([10, 0, 0]);
    expect(vertices(job).every(Number.isFinite)).toBe(true);
  });

  test('G90/G91 switching applies G92 shifts once, only to absolute targets', () => {
    const job = run([
      'G0 X10 Y20 Z30',
      'G92 X0 Y0 Z0',
      'G91',
      'G1 X2 Y-3 Z1',
      'G90',
      'G1 X0 Y0 Z0',
      'G91',
      'G0 X0',
      'G92.1',
      'G0 Y2',
      'G90',
      'G0 X0 Y0 Z0'
    ]);

    expect(vertices(job)).toEqual([0, 0, 0, 10, 20, 30, 12, 17, 31, 10, 20, 30, 10, 20, 30, 10, 22, 30, 0, 0, 0]);
    expect(job.state.positionShift).toEqual({ x: 0, y: 0, z: 0 });
  });

  test.each(['G2', 'G3'])('%s keeps I/J and R relative when G91 follows G92', (command) => {
    for (const arc of ['I5 J0', 'R5']) {
      const setup = ['G0 X10 Y20 Z30', 'G92 X0 Y0 Z0'];
      const relative = run([...setup, 'G91', `${command} X10 Y0 Z5 ${arc}`]);
      const absolute = run([...setup, 'G90', `${command} X10 Y0 Z5 ${arc}`]);

      expect([relative.state.x, relative.state.y, relative.state.z]).toEqual([20, 20, 35]);
      expect(vertices(relative)).toEqual(vertices(absolute));
      expect(vertices(relative).every(Number.isFinite)).toBe(true);
    }
  });

  test('G91 full circles leave omitted coordinates unchanged despite a G92 shift', () => {
    const setup = ['G0 X10 Y20 Z30', 'G92 X0 Y0 Z0'];
    const relative = run([...setup, 'G91', 'G2 I5 J0']);
    const absolute = run([...setup, 'G90', 'G2 I5 J0']);

    expect([relative.state.x, relative.state.y, relative.state.z]).toEqual([10, 20, 30]);
    expect(vertices(relative)).toEqual(vertices(absolute));
  });

  test('a parser/interpreter chunk boundary preserves the positioning mode', () => {
    const setup = ['G0 X10 Y20 Z30', 'G92 X0 Y0 Z0', 'G91'];
    const moves = ['G1 X2', 'G2 X10 Y0 I5 J0', 'G90', 'G0 X0 Y0 Z0'];
    const parser = new Parser();
    const interpreter = new Interpreter();
    const chunked = interpreter.execute(parser.parseGCode(setup).commands);
    interpreter.execute(parser.parseGCode(moves).commands, chunked);

    expect(vertices(chunked)).toEqual(vertices(run([...setup, ...moves])));
    expect([chunked.state.x, chunked.state.y, chunked.state.z]).toEqual([10, 20, 30]);
  });

  const runGCode = (lines: string[]): { job: Job; arc: number[][] } => {
    const parser = new Parser();
    const interpreter = new Interpreter();
    const job = interpreter.execute(parser.parseGCode(lines).commands);
    const vertices = job.paths[0].vertices;
    const points: number[][] = [];
    for (let index = 0; index < vertices.length; index += 3) {
      points.push([vertices[index], vertices[index + 1], vertices[index + 2]]);
    }
    // Drop the job origin and the point the setup move lands on, leaving the arc.
    return { job, arc: points.slice(2) };
  };

  const distanceTo = (point: number[], centerX: number, centerY: number): number =>
    Math.sqrt(Math.pow(point[0] - centerX, 2) + Math.pow(point[1] - centerY, 2));

  test('an R-mode arc resolves its endpoint relative to the current position', () => {
    // The radius branch derives deltaX/deltaY (and from those hDivD, i and j) from the
    // resolved targets, so a raw x/y would put the whole arc in the wrong place rather
    // than only misplacing the endpoint.
    const { job, arc } = runGCode(['G0 X10 Y20', 'G91', 'G2 X10 Y0 R5']);

    expect(job.state.x).toBeCloseTo(20);
    expect(job.state.y).toBeCloseTo(20);
    // A semicircle from (10,20) to (20,20): centre (15,20), radius 5.
    arc.forEach((point) => expect(distanceTo(point, 15, 20)).toBeCloseTo(5));
  });

  test('a relative move leaves the axes it omits unchanged', () => {
    const { job } = runGCode(['G0 X10 Y20 Z30', 'G91', 'G1 X10']);

    expect(job.state.x).toEqual(20);
    expect(job.state.y).toEqual(20);
    expect(job.state.z).toEqual(30);
  });

  test('I/J offsets stay relative to the arc start in relative mode', () => {
    // Per the G-code spec, G90/G91 never applies to arc centre offsets. Routing i/j
    // through resolvePosition would move this centre from (15,20) to (25,20).
    const absolute = runGCode(['G0 X10 Y20', 'G90', 'G2 X20 Y20 I5 J0']);
    const relative = runGCode(['G0 X10 Y20', 'G91', 'G2 X10 Y0 I5 J0']);

    expect(relative.arc).toEqual(absolute.arc);
    relative.arc.forEach((point) => expect(distanceTo(point, 15, 20)).toBeCloseTo(5));
  });
});

describe('extrusion dimension metadata (;WIDTH: / ;HEIGHT:)', () => {
  // The real wiring, in miniature: parse, hand the metadata to the job, then
  // execute the same commands against it (see GCodePreview.processGCode).
  // The generator comment stands in for a real file's header: dimension
  // comments alone do not identify a slicer (Slic3r shares the dialect).
  const run = (lines: string[]) => {
    const { commands, metadata } = new Parser().parseGCode(
      ['; generated by PrusaSlicer 2.9.2', 'M83', ...lines].join('\n')
    );
    const job = new Job();
    job.metadata = metadata;
    return new Interpreter().execute(commands, job);
  };

  test('paths carry no dimensions of their own when the file has no dimension comments', () => {
    const job = run(['G1 X10 Y10 E1']);

    expect(job.paths[0].extrusionWidth).toBeUndefined();
    expect(job.paths[0].lineHeight).toBeUndefined();
  });

  test('WIDTH and HEIGHT comments set the dimensions of the paths that follow', () => {
    const job = run([';WIDTH:0.45', ';HEIGHT:0.16', 'G1 X10 Y10 E1']);

    expect(job.state.extrusionWidth).toEqual(0.45);
    expect(job.state.lineHeight).toEqual(0.16);
    expect(job.paths[0].extrusionWidth).toEqual(0.45);
    expect(job.paths[0].lineHeight).toEqual(0.16);
  });

  test('a HEIGHT change mid-path folds into the path instead of breaking it', () => {
    // A dimension change used to break the path; on adaptive-layer-height
    // files that multiplied the path count and the geometry build time.
    // The announced WIDTH keeps the derivation out of it: these moves extrude
    // the same E over different lengths, so a derived width would vary too and
    // this test is about the height.
    const job = run([';WIDTH:0.45', ';HEIGHT:0.2', 'G1 X10 Y10 E1', 'G1 X20 Y10 E1', ';HEIGHT:0.3', 'G1 X30 Y10 E1']);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].hasVaryingDimensions).toBe(true);
    // per point: the seed and the first two moves at 0.2, the last move at 0.3
    expect(job.paths[0].lineHeightAt(0)).toEqual(0.2);
    expect(job.paths[0].lineHeightAt(2)).toEqual(0.2);
    expect(job.paths[0].lineHeightAt(3)).toEqual(0.3);
    expect(job.paths[0].vertices.length).toEqual(12);
  });

  test('a WIDTH comment after the first moves keeps the earlier points unknown', () => {
    const job = run(['G1 X10 Y10 E1', ';WIDTH:0.42', 'G1 X20 Y10 E1']);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].hasVaryingDimensions).toBe(true);
    // the scalar reflects the most recent width; the earlier points carry none
    expect(job.paths[0].extrusionWidth).toEqual(0.42);
    // per point: the seed and the first move predate the comment
    expect([0, 1, 2].map((point) => job.paths[0].extrusionWidthAt(point))).toEqual([undefined, undefined, 0.42]);
  });

  test('repeating the current value keeps the dimensions uniform', () => {
    const job = run([';WIDTH:0.45', ';HEIGHT:0.2', 'G1 X10 Y10 E1', ';WIDTH:0.45', ';HEIGHT:0.2', 'G1 X20 Y10 E1']);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].extrusionWidth).toEqual(0.45);
    expect(job.paths[0].hasVaryingDimensions).toBe(false);
  });

  test('an arc move also picks up the current dimensions', () => {
    const job = run(['G1 X10 Y10 E1', ';HEIGHT:0.12', 'G2 X20 Y10 I5 J0 E1']);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].lineHeight).toEqual(0.12);
    // every interpolated arc point carries the height set before the arc
    const lastPoint = job.paths[0].vertices.length / 3 - 1;
    expect(job.paths[0].lineHeightAt(lastPoint)).toEqual(0.12);
    expect(job.paths[0].lineHeightAt(0)).toBeUndefined();
  });

  test('the metadata only applies when it has been assigned to the job', () => {
    // Executing parsed commands without job.metadata (the wiring
    // GCodePreview.processGCode performs) leaves the dimensions unknown.
    const { commands } = new Parser().parseGCode([';WIDTH:0.45', 'G1 X10 Y10 E1'].join('\n'));

    const job = new Interpreter().execute(commands);

    expect(job.paths[0].extrusionWidth).toBeUndefined();
  });

  test('blank lines and unrelated comments leave the dimensions unknown', () => {
    const job = run(['', ';TYPE:External perimeter', 'G1 X10 Y10 E1', '']);

    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].extrusionWidth).toBeUndefined();
    expect(job.paths[0].lineHeight).toBeUndefined();
  });

  test('an announced width outranks the width derived from the same move', () => {
    // The move's volume implies ~1.2mm; the slicer says 0.45, and the slicer
    // is stating what it asked for rather than inferring it.
    const job = run([';WIDTH:0.45', ';HEIGHT:0.2', 'G0 X0 Y0 Z0.2', 'G1 X10 Y0 E1']);

    expect(job.extrusions[0].extrusionWidth).toEqual(0.45);
  });

  test('a file no slicer parser recognises still derives its dimensions', () => {
    // The point of deriving: it is the default for any gcode, not a Cura
    // feature. This has no slicer fingerprint at all.
    const { commands, metadata } = new Parser().parseGCode(
      ['M83', 'G28', 'G0 X0 Y0 Z0.2', 'G1 X10 Y0 E0.48'].join('\n')
    );
    const job = new Job();
    job.metadata = metadata;
    new Interpreter().execute(commands, job);

    expect(metadata.slicerName).toBeUndefined();
    expect(job.extrusions[0].lineHeight).toEqual(0.2);
    expect(job.extrusions[0].extrusionWidth).toBeGreaterThan(0);
  });

  test('a derived width change folds into the path, like an announced one', () => {
    // Same E over half the distance means twice the bead width (0.6 -> 1.2),
    // which tapers the path at the second move rather than splitting it.
    const job = run(['M83', 'G0 X0 Y0 Z0.2', 'G1 X20 Y0 E1', 'G1 X30 Y0 E1']);

    expect(job.extrusions.length).toEqual(1);
    const path = job.extrusions[0];
    expect(path.hasVaryingDimensions).toBe(true);
    expect(path.extrusionWidthAt(2)!).toBeGreaterThan(path.extrusionWidthAt(1)!);
  });
});

describe('extrusion dimensions derived from the moves', () => {
  const FILAMENT_AREA = Math.PI * (1.75 / 2) ** 2;

  /** The E increment depositing a width×height×length box of 1.75mm filament */
  const eFor = (width: number, height: number, length: number) => (width * height * length) / FILAMENT_AREA;

  /** Accumulates absolute E positions the way a slicer emits them (5 decimals) */
  const absoluteE = () => {
    let e = 0;
    return (width: number, height: number, length: number) => {
      e += eFor(width, height, length);
      return e.toFixed(5);
    };
  };

  /**
   * Parses and executes a file that announces no dimensions: a Cura header
   * stands in for one, since Cura is the slicer that never announces them,
   * but nothing here depends on the dialect — deriving is the default.
   */
  const run = (lines: string[]) => {
    const { commands, metadata } = new Parser().parseGCode(
      [';FLAVOR:Marlin', ';Generated with Cura_SteamEngine 5.7.0', 'M82', 'G28', ...lines].join('\n')
    );
    const job = new Job();
    job.metadata = metadata;
    return new Interpreter().execute(commands, job);
  };

  const dimensions = (job: Job) => job.extrusions.map((path) => [path.extrusionWidth, path.lineHeight]);

  test('round-trips programmed widths and heights through the volumetric model', () => {
    // The E values are computed from the exact widths and heights the
    // derivation should recover; a width change mid-layer tapers the path.
    const E = absoluteE();
    const job = run([
      ';LAYER:0',
      'G0 X10 Y10 Z0.2',
      `G1 X20 Y10 E${E(0.4, 0.2, 10)}`,
      `G1 X20 Y20 E${E(0.4, 0.2, 10)}`,
      ';TYPE:FILL',
      `G1 X10 Y20 E${E(0.6, 0.2, 10)}`,
      ';LAYER:1',
      'G0 Z0.4',
      `G1 X10 Y10 E${E(0.4, 0.2, 10)}`
    ]);

    // the travel to the next layer is what breaks the path, not the width
    expect(dimensions(job)).toEqual([
      [0.6, 0.2],
      [0.4, 0.2]
    ]);
    expect(job.extrusions[0].vertices).toEqual([10, 10, 0.2, 20, 10, 0.2, 20, 20, 0.2, 10, 20, 0.2]);
    // per point: the derived width steps up exactly at the FILL move. The seed
    // point carries it too — unlike a comment, the derivation runs on the very
    // move that opens the path, so its start is already measured.
    expect([0, 1, 2, 3].map((point) => job.extrusions[0].extrusionWidthAt(point))).toEqual([0.4, 0.4, 0.4, 0.6]);
  });

  test('recovers an adaptive layer height sequence from the Z steps', () => {
    const E = absoluteE();
    const job = run([
      'G0 X0 Y0 Z0.2',
      `G1 X10 Y0 E${E(0.4, 0.2, 10)}`,
      'G0 Z0.36',
      `G1 X0 Y0 E${E(0.4, 0.16, 10)}`,
      'G0 Z0.66',
      `G1 X10 Y0 E${E(0.4, 0.3, 10)}`
    ]);

    expect(dimensions(job)).toEqual([
      [0.4, 0.2],
      [0.4, 0.16],
      [0.4, 0.3]
    ]);
  });

  test('a z-hop travel between layers does not corrupt the derived height', () => {
    // The hop raises Z to 0.7 mid-travel; the height must come from the
    // extrusion Zs (0.2 then 0.4), not from the last-seen Z.
    const E = absoluteE();
    const job = run([
      'G0 X0 Y0 Z0.2',
      `G1 X10 Y0 E${E(0.4, 0.2, 10)}`,
      'G0 Z0.7',
      'G0 X20 Y0',
      'G0 Z0.4',
      `G1 X30 Y0 E${E(0.4, 0.2, 10)}`
    ]);

    expect(dimensions(job)).toEqual([
      [0.4, 0.2],
      [0.4, 0.2]
    ]);
  });

  test('a G92 E reset between layers keeps the extruded lengths right', () => {
    const job = run([
      'G0 X0 Y0 Z0.2',
      `G1 X10 Y0 E${eFor(0.4, 0.2, 10).toFixed(5)}`,
      'G92 E0',
      'G0 Z0.4',
      `G1 X0 Y0 E${eFor(0.4, 0.2, 10).toFixed(5)}`
    ]);

    expect(dimensions(job)).toEqual([
      [0.4, 0.2],
      [0.4, 0.2]
    ]);
  });

  test('relative extrusion mode (M83) derives the same dimensions', () => {
    const job = run([
      'M83',
      'G0 X0 Y0 Z0.2',
      `G1 X10 Y0 E${eFor(0.4, 0.2, 10).toFixed(5)}`,
      `G1 X10 Y10 E${eFor(0.6, 0.2, 10).toFixed(5)}`
    ]);

    expect(job.extrusions.length).toEqual(1);
    expect([0, 1, 2].map((point) => job.extrusions[0].extrusionWidthAt(point))).toEqual([0.4, 0.4, 0.6]);
    expect([0, 1, 2].map((point) => job.extrusions[0].lineHeightAt(point))).toEqual([0.2, 0.2, 0.2]);
  });

  test('ironing re-extrudes at the same Z without disturbing the dimensions', () => {
    // The ironing pass deposits far too little material to be a real line
    // (derived width 0.04); both its width and its zero Z step are discarded,
    // so it continues the finished surface's path untouched.
    const E = absoluteE();
    const job = run(['G0 X0 Y0 Z0.2', `G1 X10 Y0 E${E(0.4, 0.2, 10)}`, `G1 X0 Y0 E${E(0.04, 0.2, 10)}`]);

    expect(job.extrusions.length).toEqual(1);
    expect(job.extrusions[0].vertices).toEqual([0, 0, 0.2, 10, 0, 0.2, 0, 0, 0.2]);
    expect(dimensions(job)).toEqual([[0.4, 0.2]]);
  });

  test("spiralize's continuous micro-climb keeps the layer height it entered with", () => {
    const E = absoluteE();
    const job = run([
      'G0 X0 Y0 Z0.2',
      `G1 X10 Y0 E${E(0.4, 0.2, 10)}`,
      `G1 X10 Y10 Z0.205 E${E(0.4, 0.2, 10)}`,
      `G1 X0 Y10 Z0.21 E${E(0.4, 0.2, 10)}`
    ]);

    // each 0.005 step is below the plausible layer range and is skipped
    expect(job.extrusions.length).toEqual(1);
    expect(dimensions(job)).toEqual([[0.4, 0.2]]);
  });

  test('an UltiGCode-flavored file derives nothing', () => {
    // UltiGCode E values are mm³, which the filament-length model would turn
    // into confidently wrong widths; the parser leaves derivation off.
    const { commands, metadata } = new Parser().parseGCode(
      [';FLAVOR:UltiGCode', ';LAYER:0', 'G0 X0 Y0 Z0.2', 'G1 X10 Y0 E1.6'].join('\n')
    );
    const job = new Job();
    job.metadata = metadata;
    new Interpreter().execute(commands, job);

    expect(job.extrusions[0].extrusionWidth).toBeUndefined();
    expect(job.extrusions[0].lineHeight).toBeUndefined();
  });
});

describe('tool changes (T0-T7)', () => {
  const run = (lines: string[]) => new Interpreter().execute(new Parser().parseGCode(lines).commands);
  const summary = (job: Job) => job.extrusions.map((path) => ({ tool: path.tool, vertices: path.vertices }));

  test('a tool change between two extrusions breaks the path and assigns the new tool', () => {
    const job = run(['G0 X0 Y0 Z0.2', 'G1 X10 E1', 'T1', 'G1 X20 E2']);

    expect(job.state.tool).toEqual(1);
    expect(summary(job)).toEqual([
      { tool: 0, vertices: [0, 0, 0.2, 10, 0, 0.2] },
      { tool: 1, vertices: [10, 0, 0.2, 20, 0, 0.2] }
    ]);
  });

  test('a tool change followed by a travel assigns the next extrusion to the new tool', () => {
    const job = run(['G0 X0 Y0 Z0.2', 'G1 X10 E1', 'T1', 'G0 X10 Y0 Z0.2', 'G1 X20 E2']);

    expect(summary(job)).toEqual([
      { tool: 0, vertices: [0, 0, 0.2, 10, 0, 0.2] },
      { tool: 1, vertices: [10, 0, 0.2, 20, 0, 0.2] }
    ]);
  });

  test('re-selecting the current tool does not break the path', () => {
    const job = run(['G0 X0 Y0 Z0.2', 'G1 X10 E1', 'T0', 'G1 X20 E2']);

    expect(summary(job)).toEqual([{ tool: 0, vertices: [0, 0, 0.2, 10, 0, 0.2, 20, 0, 0.2] }]);
  });
});

describe('malformed coordinates through the whole pipeline', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);
  const allVertices = (job: Job) => job.paths.flatMap((path) => path.vertices);
  // The vertices the final command contributed, without the lead-in move or the
  // implicit start point at the origin.
  const ysOf = (vertices: number[]) => vertices.filter((_, index) => index % 3 === 1);
  const zsOf = (vertices: number[]) => vertices.filter((_, index) => index % 3 === 2);
  // M83: the fixtures repeat the same E value per move, i.e. relative distances
  const tailVertices = (setup: string[], last: string) => {
    const before = allVertices(run(['M83', ...setup].join('\n'))).length;
    return allVertices(run(['M83', ...setup, last].join('\n'))).slice(before);
  };

  test('a malformed coordinate leaves the job state finite', () => {
    // Before validation at the parser boundary, Xabc parsed to NaN and `x ?? state.x`
    // kept it (?? only catches null/undefined), poisoning the state from there on.
    const job = run(['M83', 'G1 X10 Y10 Z1 E1', 'G1 Xabc Y20 E1'].join('\n'));

    expect(job.state.x).toEqual(10);
    expect(job.state.y).toEqual(20);
    expect(Number.isFinite(job.state.x)).toBe(true);
  });

  test('a malformed coordinate does not poison the bounding box', () => {
    const job = run(['M83', 'G0 X10 Y10 Z1', 'G1 Xabc Y20 E1', 'G1 X30 Y30 E1'].join('\n'));

    expect(job.boundingBox.isValid).toBe(true);
    expect(job.boundingBox.corners).toEqual({
      min: expect.objectContaining({ x: 10, y: 10, z: 1 }),
      max: expect.objectContaining({ x: 30, y: 30, z: 1 })
    });
  });

  test('an overflowing coordinate does not stretch the bounding box to Infinity', () => {
    const huge = '1' + '0'.repeat(400);
    const job = run(['M83', 'G0 X10 Y10 Z1', `G1 X${huge} E1`, 'G1 X30 Y30 E1'].join('\n'));

    expect(job.boundingBox.size).toEqual(expect.objectContaining({ x: 20, y: 20, z: 0 }));
  });

  test('an arc emits only finite segment points', () => {
    // A half circle of radius 5 -- enough arc length to go through the segment loop.
    const job = run(['M83', 'G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n'));

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

  test('arcChordTolerance tunes how densely arcs are tessellated', () => {
    const gcode = ['G1 X10 Y10 Z1 E1', 'G2 X20 Y10 I5 J0 E1'].join('\n');
    const runWith = (tolerance?: number) =>
      new Interpreter({ arcChordTolerance: tolerance }).execute(new Parser().parseGCode(gcode).commands);

    const defaultCount = allVertices(runWith()).length;

    expect(allVertices(runWith(0.005)).length).toBeGreaterThan(defaultCount);
    expect(allVertices(runWith(0.5)).length).toBeLessThan(defaultCount);
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
    const job = run(['M83', 'G1 X10 Y10 Z1 E1', 'G2 X10 Y10 R5 E1'].join('\n'));

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
    const job = run(['M83', 'G1 X10 Y10 Z1 E1', `G2 X10 Y10 I${huge} J${huge} E1`].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
  });

  test('an arc with a malformed endpoint still produces only finite points', () => {
    const job = run(['M83', 'G1 X10 Y10 Z1 E1', 'G2 Xabc Y20 I5 J0 E1'].join('\n'));

    const points = job.paths.flatMap((path) => path.vertices);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((value) => Number.isFinite(value))).toBe(true);
    expect(job.boundingBox.isValid).toBe(true);
    expect(job.boundingBox.corners?.min.x).not.toBeNaN();
  });
});

describe('extrusion bounding box', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('includes the starting point of an extrusion entered by a travel move', () => {
    // A path's seed point is never a move destination, so it used to be missing
    // from the bounds: a travel to X0 followed by a single extrusion to X10
    // reported a zero-width box pinned at X10 (#451).
    const job = run(['M83', 'G0 X0 Y0 Z0.2', 'G1 X10 E1'].join('\n'));

    expect(job.boundingBox.corners?.min.x).toEqual(0);
    expect(job.boundingBox.corners?.max.x).toEqual(10);
    expect(job.boundingBox.size?.x).toEqual(10);
    expect(job.boundingBox.center?.x).toEqual(5);
  });

  test('a travel move does not stretch the bounds', () => {
    // Only the extrusion's own start counts; the travel lead-up beyond it stays out.
    const job = run(['M83', 'G0 X-50 Y0 Z0.2', 'G0 X0', 'G1 X10 E1'].join('\n'));

    expect(job.boundingBox.corners?.min.x).toEqual(0);
    expect(job.boundingBox.corners?.max.x).toEqual(10);
  });
});

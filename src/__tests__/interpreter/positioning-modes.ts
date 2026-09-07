import { Interpreter } from '../../interpreter';
import { Job } from '../../job';
import { Parser } from '../../parser/gcode-parser';

const run = (lines: string[]) => new Interpreter().execute(new Parser().parseGCode(lines).commands);
const vertices = (job: Job) => job.paths.flatMap((path) => path.vertices);

describe('positioning modes with unknown axes and workspace shifts', () => {
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

  test('XYZ mode changes preserve the extrusion mode chosen with M82/M83', () => {
    const job = run(['M83', 'G91', 'G1 X10 E2', 'G90', 'G1 X20 E2', 'M82', 'G91', 'G1 X5 E5']);

    expect(job.state.x).toEqual(25);
    expect(job.state.e).toEqual(5);
    expect(job.stats.extrusionDistance).toEqual(5);
    expect(job.state.relativeExtrusion).toBe(false);
  });
});

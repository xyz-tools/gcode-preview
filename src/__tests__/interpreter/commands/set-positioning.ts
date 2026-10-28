import { test, expect, describe } from 'vitest';
import { GCodeCommand, Parser } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { PathType } from '../../../path';
import { setAbsolutePositioning, setRelativePositioning } from '../../../interpreter/commands';
import { Job } from '../../../job';

test('G90 sets absolute positioning mode', () => {
  const command = new GCodeCommand('G90', 'g90', {});
  const job = new Job();
  job.state.positioning = 'relative';

  setAbsolutePositioning(command, job);

  expect(job.state.positioning).toEqual('absolute');
  expect(job.state.relativeExtrusion).toBe(false);
});

test('G91 sets relative positioning mode', () => {
  const command = new GCodeCommand('G91', 'g91', {});
  const job = new Job();

  setRelativePositioning(command, job);

  expect(job.state.positioning).toEqual('relative');
  expect(job.state.relativeExtrusion).toBe(true);
});

describe('positioning and extrusion modes through the parser', () => {
  const run = (lines: string[]) => new Interpreter().execute(new Parser().parseGCode(lines).commands);

  test('G91 makes repeated E words extrude on every move without M82/M83', () => {
    const job = run(['G28', 'G91', 'G1 X10 E0.5', 'G1 X10 E0.5', 'G1 X10 E0.5']);

    expect(job.state.x).toEqual(30);
    expect(job.state.e).toEqual(1.5);
    expect(job.stats.extrusionDistance).toEqual(1.5);
    expect(job.paths).toHaveLength(1);
    expect(job.paths[0].travelType).toEqual(PathType.Extrusion);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0]);
  });

  test('G90 restores absolute E after G91 without resetting the extruder position', () => {
    const job = run(['G28', 'G91', 'G1 X10 E2', 'G90', 'G1 X20 E3', 'G1 X30 E3']);

    expect(job.state.e).toEqual(3);
    expect(job.stats.extrusionDistance).toEqual(3);
    expect(job.paths.map((path) => path.travelType)).toEqual([PathType.Extrusion, PathType.Travel]);
    expect(job.paths[1].vertices).toEqual([20, 0, 0, 30, 0, 0]);
  });

  test.each(['G90', 'M82'])('%s selects absolute E after M83', (mode) => {
    const job = run(['G28', 'M83', mode, 'G1 X10 E1', 'G1 X20 E1']);

    expect(job.state.e).toEqual(1);
    expect(job.stats.extrusionDistance).toEqual(1);
    expect(job.paths.map((path) => path.travelType)).toEqual([PathType.Extrusion, PathType.Travel]);
  });

  test.each(['G91', 'M83'])('%s selects relative E after M82', (mode) => {
    const job = run(['G28', 'M82', mode, 'G1 X10 E1', 'G1 X20 E1']);

    expect(job.state.e).toEqual(2);
    expect(job.stats.extrusionDistance).toEqual(2);
    expect(job.paths).toHaveLength(1);
    expect(job.paths[0].travelType).toEqual(PathType.Extrusion);
  });

  test('M82 and M83 override E without changing the selected XYZ mode', () => {
    const absoluteE = run(['G28', 'G91', 'M82', 'G1 X10 E1', 'G1 X10 E2']);
    const relativeE = run(['G28', 'G90', 'M83', 'G1 X10 E1', 'G1 X20 E1']);

    expect(absoluteE.state.positioning).toEqual('relative');
    expect(relativeE.state.positioning).toEqual('absolute');
    for (const job of [absoluteE, relativeE]) {
      expect(job.state.x).toEqual(20);
      expect(job.state.e).toEqual(2);
      expect(job.stats.extrusionDistance).toEqual(2);
    }
  });

  test('relative E survives a parser chunk boundary and composes with G92 E0', () => {
    const parser = new Parser();
    const interpreter = new Interpreter();
    const job = interpreter.execute(parser.parseGCode(['G28', 'G91', 'G1 X10 E0.5']).commands);
    interpreter.execute(parser.parseGCode(['G92 E0', 'G1 X10 E0.5', 'G1 X10 E0.5']).commands, job);

    expect(job.state.e).toEqual(1);
    expect(job.stats.extrusionDistance).toEqual(1.5);
    expect(job.paths).toHaveLength(1);
    expect(job.paths[0].travelType).toEqual(PathType.Extrusion);
  });

  test('relative inch E values are converted once before accumulating', () => {
    const job = run(['G28', 'G20', 'G91', 'G1 X1 E0.5', 'G1 X1 E0.5', 'G21', 'G1 X1 E1']);

    expect(job.state.x).toBeCloseTo(51.8);
    expect(job.state.e).toBeCloseTo(26.4);
    expect(job.stats.extrusionDistance).toBeCloseTo(26.4);
  });
});

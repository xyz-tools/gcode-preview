import { Interpreter } from '../interpreter';
import { Parser } from '../parser/gcode-parser';
import { Job } from '../job';
import { PathType } from '../path';

function run(lines: string[], chunkSize = lines.length) {
  const parser = new Parser();
  const interpreter = new Interpreter();
  const job = new Job();
  for (let i = 0; i < lines.length; i += chunkSize) {
    interpreter.execute(parser.parseGCode(lines.slice(i, i + chunkSize)).commands, job);
  }
  return job;
}

test('counts E-only purges', () => {
  expect(run(['M83', 'G1 E10']).stats.extrusionDistance).toBe(10);
});

test('does not count recovery during XYZ movement as new filament', () => {
  const job = run(['M83', 'G1 X0 Y0 Z0', 'G1 X10 E10', 'G1 E-1', 'G1 X20 E1']);
  expect(job.stats.extrusionDistance).toBe(10);
  expect(job.paths.at(-1)?.travelType).toBe(PathType.Extrusion);
});

describe.each(['M82', 'M83'])('%s consumption', (mode) => {
  test.each(['G1', 'G1 X20', 'G2 X20 I5', 'G3 X20 R5'])('partial recovery and excess via %s', (recovery) => {
    const absolute = mode === 'M82';
    const lines = [
      mode,
      'G28',
      'G1 X10 E10',
      `G1 E${absolute ? 8 : -2}`,
      `G1 E${absolute ? 9 : 1}`,
      'G92 E0',
      `${recovery} E3`,
      'G1 X30',
      `G1 E${absolute ? 2 : -1}`
    ];
    const expected = run(lines);
    expect(expected.stats.extrusionDistance).toBe(12);
    for (let size = 1; size < lines.length; size++) {
      const chunked = run(lines, size);
      expect(chunked.stats).toEqual(expected.stats);
      expect(chunked.paths.map((path) => path.vertices)).toEqual(expected.paths.map((path) => path.vertices));
    }
  });

  test.each(['G1', 'G1 X20', 'G2 X20 I5'])('equal recovery via %s adds nothing', (recovery) => {
    const lines = [
      mode,
      'G28',
      'G1 X10 E10',
      `G1 X15 E${mode === 'M82' ? 8 : -2}`,
      `${recovery} E${mode === 'M82' ? 10 : 2}`
    ];
    expect(run(lines).stats.extrusionDistance).toBe(10);
  });
});

test('arc retractions are repaid and accounting is isolated per job', () => {
  expect(run(['M83', 'G28', 'G2 X10 I5 E-2', 'G1 E3']).stats.extrusionDistance).toBe(1);
  expect(run(['M83', 'G1 E3']).stats.extrusionDistance).toBe(3);
});

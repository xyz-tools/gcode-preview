/**
 * P1 reproduction: arc-defaults
 *
 * From X0 Y0 Z0.2, compare G2 X10 Y0 I5 J0 E1 with omitted J0 or Y0.
 * Expected: all forms produce the same curved semicircle.
 * Actual: each omitted-word form emits only the start and endpoint.
 * The explicit-parameter control passes; both omitted-word regressions fail.
 *
 * Run: NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p1-reproduction.ts
 * The Node 26 flag avoids the happy-dom storage conflict. Failures are intentional
 * until the implementation is fixed.
 */
import { expect, test } from 'vitest';
import { Parser } from '../parser/gcode-parser';
import { Interpreter } from '../interpreter';

function arc(command: string) {
  const job = new Interpreter().execute(new Parser().parseGCode('G0 X0 Y0 Z0.2\n' + command).commands);
  return job.extrusions[0];
}

test('explicit zero offsets produce a curved reference arc', () => {
  const points = arc('G2 X10 Y0 I5 J0 E1').path();
  expect(points.length).toBeGreaterThan(2);
  expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(4);
});

test.each([
  ['J offset', 'G2 X10 Y0 I5 E1'],
  ['Y endpoint', 'G2 X10 I5 J0 E1']
])('omitting the %s preserves the same curved arc', (_name, command) => {
  const actual = arc(command);
  const explicit = arc('G2 X10 Y0 I5 J0 E1');
  expect.soft(actual.path().length).toBeGreaterThan(2);
  expect(actual.vertices).toEqual(explicit.vertices);
});

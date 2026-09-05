/**
 * P2 reproduction: extrusion-bounds
 *
 * Travel to X0 Y0 Z0.2, then extrude a single segment to X10.
 * Expected: bounds span X0 through X10, with width 10 and center X5.
 * Actual: minimum and maximum X are both 10, giving zero width.
 * A reverse extrusion back to X0 is a passing control because both ends then
 * occur as destination points.
 *
 * Run: NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p2-reproduction.ts
 * The Node 26 flag avoids the happy-dom storage conflict. Regression failures
 * are intentional until the implementation is fixed.
 */
import { expect, test } from 'vitest';
import { Parser } from '../parser/gcode-parser';
import { Interpreter } from '../interpreter';

function run(lines: string[]) {
  return new Interpreter().execute(new Parser().parseGCode(lines).commands);
}

test.each([false, true])('bounds include both ends (return extrusion: %s)', (returnToStart) => {
  const lines = ['G0 X0 Y0 Z0.2', 'G1 X10 E1'];
  if (returnToStart) lines.push('G1 X0 E1');
  const job = run(lines);
  expect(job.extrusions[0].vertices.slice(0, 6)).toEqual([0, 0, 0.2, 10, 0, 0.2]);
  expect.soft(job.boundingBox.corners?.min.x).toBe(0);
  expect.soft(job.boundingBox.corners?.max.x).toBe(10);
  expect.soft(job.boundingBox.size?.x).toBe(10);
  expect(job.boundingBox.center?.x).toBe(5);
});

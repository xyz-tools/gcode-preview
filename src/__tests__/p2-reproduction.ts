/**
 * P2 reproduction: tool-change
 *
 * Extrude from X0 to X10 with T0, select T1, then extrude to X20.
 * Expected: two extrusion paths assigned to tools 0 and 1.
 * Actual: both moves remain in one path owned by tool 0.
 * A travel between the extrusions is a passing control.
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

test.each([false, true])('tool ownership follows T1 (intervening travel: %s)', (withTravel) => {
  const lines = ['G0 X0 Y0 Z0.2', 'G1 X10 E1', 'T1'];
  if (withTravel) lines.push('G0 X10 Y0 Z0.2');
  lines.push('G1 X20 E1');
  const job = run(lines);
  expect(job.state.tool).toBe(1);
  expect(job.extrusions.map((path) => ({ tool: path.tool, vertices: path.vertices }))).toEqual([
    { tool: 0, vertices: [0, 0, 0.2, 10, 0, 0.2] },
    { tool: 1, vertices: [10, 0, 0.2, 20, 0, 0.2] }
  ]);
});

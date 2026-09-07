import { test, expect, describe } from 'vitest';
import { Parser, GCodeCommand } from '../../../parser/gcode-parser';
import { Interpreter } from '../../../interpreter';
import { probe } from '../../../interpreter/commands';
import { Job } from '../../../job';
import { PathType } from '../../../path';

describe('probe (G31)', () => {
  const run = (gcode: string) => new Interpreter().execute(new Parser().parseGCode(gcode).commands);

  test('a downward Z probe crossing the origin plane is assumed to trigger at Z0', () => {
    const command = new GCodeCommand('G31 Z-11.8', 'g31', { z: -11.8 });
    const job = new Job();
    job.state.z = 0.2;

    probe(command, job);

    expect(job.state.z).toEqual(0);
    expect(job.stats.points).toEqual(1);
  });

  test('a probe to a target above the origin plane travels to the commanded target', () => {
    const command = new GCodeCommand('G31 Z2', 'g31', { z: 2 });
    const job = new Job();
    job.state.z = 5;

    probe(command, job);

    expect(job.state.z).toEqual(2);
  });

  test('a probe starting at or below the origin plane travels to the commanded target', () => {
    const command = new GCodeCommand('G31 Z-5', 'g31', { z: -5 });
    const job = new Job();
    job.state.z = -1;

    probe(command, job);

    expect(job.state.z).toEqual(-5);
  });

  test('X/Y targets are kept as commanded while Z is clamped', () => {
    const command = new GCodeCommand('G31 X1 Y2 Z-3', 'g31', { x: 1, y: 2, z: -3 });
    const job = new Job();
    job.state.z = 1;

    probe(command, job);

    expect(job.state.x).toEqual(1);
    expect(job.state.y).toEqual(2);
    expect(job.state.z).toEqual(0);
  });

  test('an X-only probe travels to the target without touching Z', () => {
    const command = new GCodeCommand('G31 X5', 'g31', { x: 5 });
    const job = new Job();
    job.state.z = 3;

    probe(command, job);

    expect(job.state.x).toEqual(5);
    expect(job.state.z).toEqual(3);
  });

  test('a G31 without axis words is ignored (Marlin dock-sled form)', () => {
    const command = new GCodeCommand('G31', 'g31', {});
    const job = new Job();

    probe(command, job);

    expect(job.paths.length).toEqual(0);
    expect(job.inprogressPath).toBeUndefined();
    expect(job.stats.points).toEqual(0);
  });

  test('a G31 with a P word is ignored (RepRapFirmware set-trigger form)', () => {
    const command = new GCodeCommand('G31 P500 X0 Y0 Z2.6', 'g31', { p: 500, x: 0, y: 0, z: 2.6 });
    const job = new Job();
    job.state.z = 5;

    probe(command, job);

    expect(job.state.z).toEqual(5);
    expect(job.inprogressPath).toBeUndefined();
  });

  test('probe targets are translated by the position shift', () => {
    const job = run(['G0 X10', 'G92 X0', 'G31 X5'].join('\n'));

    expect(job.state.x).toEqual(15);
  });

  test('renders as a travel move, breaking an in-progress extrusion', () => {
    const job = run(['G1 X10 E1', 'G31 X20'].join('\n'));

    expect(job.paths.length).toEqual(2);
    expect(job.paths[0].travelType).toEqual(PathType.Extrusion);
    expect(job.paths[1].travelType).toEqual(PathType.Travel);
    expect(job.paths[1].vertices).toEqual([10, 0, 0, 20, 0, 0]);
  });

  test('continues an in-progress travel path', () => {
    const job = run(['G0 X5', 'G31 Z-2'].join('\n'));

    // starting at the assumed origin (un-homed), the probe cannot cross the
    // origin plane, so it travels to the commanded depth
    expect(job.paths.length).toEqual(1);
    expect(job.paths[0].vertices).toEqual([0, 0, 0, 5, 0, 0, 5, 0, -2]);
  });

  test('a repeated probe without a lift stays at the trigger plane', () => {
    // fast-probe-then-slow-probe without an intervening retract: the head is
    // already sitting on the trigger, so the second probe must not dive
    // through the plane
    const job = run(['G0 Z0.5', 'G31 Z-10', 'G31 Z-2'].join('\n'));

    expect(job.state.z).toEqual(0);
    expect(job.paths[0].vertices.slice(-1)[0]).toEqual(0);
  });

  test('a touch-off cycle converges instead of drifting upward', () => {
    // The mach3.gcode idiom: probe, re-zero, lift, re-zero — twice. Without the
    // assumed Z0 trigger the position shift would grow every cycle (#437).
    const cycle = ['G0 Z0.2', 'G31 Z-11.8', 'G92 Z0', 'G0 Z0.039', 'G92 Z0'];
    const job = run([...cycle, ...cycle].join('\n'));

    expect(job.state.positionShift.z).toEqual(0.039);
    expect(job.state.z).toEqual(0.039);
    const { vertices } = job.paths[0];
    // Both probes bottom out at physical Z0 (3rd and 6th points)
    expect(vertices[8]).toEqual(0);
    expect(vertices[17]).toEqual(0);
    expect(vertices.slice(-1)[0]).toEqual(0.039);
  });
});

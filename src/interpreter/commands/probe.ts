import { toMillimeters } from '../../units';
import { PathType } from '../../path';
import type { CommandHandler } from '../../interpreter';

/**
 * Executes a straight probe command (G31, G38.2-G38.5)
 * @param command - GCodeCommand containing the probe target
 * @param job - Job instance to update
 * @remarks
 * A probe moves toward its target and stops on contact, at a point a previewer
 * cannot know. A probe below the origin plane from a known Z at or above it is
 * assumed to trigger at physical Z0 (the material top on the origin plane),
 * which makes the G92 re-zeroes that follow a touch-off converge each cycle
 * exactly like on a real machine, and keeps a repeated probe without a lift
 * sitting on the plane instead of diving through it (see #437). Other probes —
 * including from an unknown or assumed Z origin — render as a
 * plain travel to the commanded target. The trigger is assumed on the Z axis only; X/Y targets
 * are kept as commanded. A G31 carrying a P word is RepRapFirmware's
 * set-trigger-values form, not a move, and is ignored; one without any axis
 * words (e.g. Marlin's dock-sled G31) is also ignored. The G38 variants only
 * differ in probe direction and error semantics (G38.4/G38.5 probe away from
 * the workpiece; the odd variants tolerate a missed trigger), neither of which
 * a preview can observe, so all of them share this behavior.
 */
export const probe: CommandHandler = (command, job) => {
  const { state } = job;
  const { units } = state;
  const { params } = command;

  if (params.p !== undefined) {
    return;
  }

  const x = toMillimeters(params.x, units);
  const y = toMillimeters(params.y, units);
  const z = toMillimeters(params.z, units);

  if (x === undefined && y === undefined && z === undefined) {
    return;
  }

  job.stats.points++;

  const fromZ = state.z;
  const hasKnownZ = state.hasKnownZ;
  const currentPath = job.continuePath(PathType.Travel);

  if (state.positioning === 'relative') {
    state.moveBy(x, y, z);
  } else {
    state.moveTo(x, y, z);
  }

  // Clamp the resolved physical target, never the raw relative offset.
  if (z !== undefined && hasKnownZ && fromZ! >= 0 && state.z! < 0) {
    state.z = 0;
  }

  const pos = job.resolvePosition();
  currentPath.addPoint(pos.x, pos.y, pos.z);
};

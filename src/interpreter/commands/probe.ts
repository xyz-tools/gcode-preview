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
 * including from an un-homed Z, whose real position is unknown — render as a
 * plain travel to the commanded target. The trigger is assumed on the Z axis only; X/Y targets
 * are kept as commanded. A G31 carrying a P word is RepRapFirmware's
 * set-trigger-values form, not a move, and is ignored; one without any axis
 * words (e.g. Marlin's dock-sled G31) is also ignored.
 */
export const probe: CommandHandler = (command, job) => {
  const { state } = job;
  const { params } = command;

  if (params.p !== undefined) {
    return;
  }

  const { positionShift } = state;
  const x = params.x === undefined ? undefined : params.x + positionShift.x;
  const y = params.y === undefined ? undefined : params.y + positionShift.y;
  let z = params.z === undefined ? undefined : params.z + positionShift.z;

  if (x === undefined && y === undefined && z === undefined) {
    return;
  }

  if (z !== undefined && z < 0 && state.z !== undefined && state.z >= 0) {
    z = 0;
  }

  job.stats.points++;

  let currentPath = job.inprogressPath;
  if (currentPath === undefined || currentPath.travelType !== PathType.Travel) {
    currentPath = job.breakPath(PathType.Travel);
  }

  state.x = x ?? state.x;
  state.y = y ?? state.y;
  state.z = z ?? state.z;

  const pos = job.resolvePosition();
  currentPath.addPoint(pos.x, pos.y, pos.z);
};

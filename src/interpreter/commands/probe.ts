import type { CommandOf } from 'gcode-ast';
import { PathType } from '../../path';
import type { Job } from '../../job';

/** Every probing command this handler covers. */
type ProbeCommand = CommandOf<'G31' | 'G38.2' | 'G38.3' | 'G38.4' | 'G38.5'>;

/**
 * Executes a straight probe command (G31, G38.2-G38.5)
 * @param command - The typed probe node
 * @param job - Job instance to update
 * @remarks
 * A probe moves toward its target and stops on contact, at a point a previewer
 * cannot know. A probe below the origin plane from a known Z at or above it is
 * assumed to trigger at physical Z0 (the material top on the origin plane),
 * which makes the G92 re-zeroes that follow a touch-off converge each cycle
 * exactly like on a real machine, and keeps a repeated probe without a lift
 * sitting on the plane instead of diving through it (see #437). Other probes —
 * including from an un-homed Z, whose real position is unknown — render as a
 * plain travel to the commanded target. The trigger is assumed on the Z axis
 * only; X/Y targets are kept as commanded. The G38 variants only differ in
 * probe direction and error semantics (G38.4/G38.5 probe away from the
 * workpiece; the odd variants tolerate a missed trigger), neither of which a
 * preview can observe, so all of them share this behavior.
 *
 * Which of the three G31s a line is comes off the node's `form` rather than
 * being re-derived here: RepRapFirmware's set-trigger-values form (a `P` word)
 * and Marlin's dock-sled form (no axis words) are both configuration, not
 * motion, and are ignored.
 */
export const probe = (command: ProbeCommand, job: Job): void => {
  const { state } = job;

  if (command.type === 'G31' && command.form !== 'move') {
    return;
  }

  const { positionShift } = state;
  const x = command.x === undefined ? undefined : command.x + positionShift.x;
  const y = command.y === undefined ? undefined : command.y + positionShift.y;
  let z = command.z === undefined ? undefined : command.z + positionShift.z;

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

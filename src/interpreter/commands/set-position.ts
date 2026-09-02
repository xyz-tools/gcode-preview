import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G92 set position command
 * @param command - GCodeCommand containing the axis parameters
 * @param job - Job instance to update
 * @remarks
 * Redefines the current logical position without moving: each given axis is
 * set to its value, and a bare `G92` without any words resets every axis
 * (including E) to zero, following RepRap semantics. When the resolved
 * position actually changes, the in-progress path is broken and reseeded at
 * the new position, so the next move does not draw a segment the printer
 * never traveled. `isHomed` is left untouched: as in Marlin, G92 trusts the
 * given coordinates but does not home the axes.
 */
export const setPosition: CommandHandler = (command, job) => {
  const { x, y, z, e } = command.params;
  const { state } = job;
  const before = job.resolvePosition();

  if (Object.keys(command.params).length === 0) {
    state.x = 0;
    state.y = 0;
    state.z = 0;
    state.e = 0;
  } else {
    state.x = x ?? state.x;
    state.y = y ?? state.y;
    state.z = z ?? state.z;
    state.e = e ?? state.e;
  }

  const after = job.resolvePosition();
  const moved = before.x !== after.x || before.y !== after.y || before.z !== after.z;

  if (moved && job.inprogressPath !== undefined) {
    job.breakPath(job.inprogressPath.travelType);
  }
};

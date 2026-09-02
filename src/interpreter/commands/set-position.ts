import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G92 set position command
 * @param command - GCodeCommand containing the axis parameters
 * @param job - Job instance to update
 * @remarks
 * Redefines the current logical position without moving: each given axis is set
 * to its value, and a bare `G92` without axis words resets every axis
 * (including E) to zero. When X, Y or Z change, the in-progress path is broken
 * and reseeded at the new position, so the next move does not draw a segment
 * the printer never traveled. `isHomed` is left untouched: as in Marlin, G92
 * trusts the given coordinates but does not home the axes.
 */
export const setPosition: CommandHandler = (command, job) => {
  const { x, y, z, e } = command.params;
  const { state } = job;

  const xyzGiven = x !== undefined || y !== undefined || z !== undefined;
  const bare = !xyzGiven && e === undefined;

  if (bare) {
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

  if ((xyzGiven || bare) && job.inprogressPath !== undefined) {
    job.breakPath(job.inprogressPath.travelType);
  }
};

import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G92 set position command
 * @param command - GCodeCommand containing the axis parameters
 * @param job - Job instance to update
 * @remarks
 * G92 gives the current position new coordinates without moving the printhead,
 * so it only adjusts `state.positionShift` so that each given axis value maps
 * to the current physical position; the physical position and paths are
 * untouched. A bare `G92` without any words resets every axis (including E) to
 * zero, following RepRap semantics. E is set directly on the state: as in
 * Marlin, the extruder position is not part of the workspace shift. `isHomed`
 * is also left untouched: G92 trusts the given coordinates but does not home
 * the axes.
 */
export const setPosition: CommandHandler = (command, job) => {
  const { x, y, z, e } = command.params;
  const { state } = job;
  const { positionShift } = state;
  const physical = job.resolvePosition();

  if (Object.keys(command.params).length === 0) {
    positionShift.x = physical.x;
    positionShift.y = physical.y;
    positionShift.z = physical.z;
    state.e = 0;
    return;
  }

  if (x !== undefined) {
    positionShift.x = physical.x - x;
  }
  if (y !== undefined) {
    positionShift.y = physical.y - y;
  }
  if (z !== undefined) {
    positionShift.z = physical.z - z;
  }
  state.e = e ?? state.e;
};

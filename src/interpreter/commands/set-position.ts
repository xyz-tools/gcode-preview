import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Executes a G92 set position command
 * @param command - The typed G92 node
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
 *
 * "Bare" is read off `words`, not off the typed axis fields. The node names
 * only X/Y/Z/E, so a `G92 F3000` would look bare through them and reset the
 * workspace it should leave alone; `words` still holds every letter on the
 * line, the command word included, so a length of one is the real test.
 */
export const setPosition = (command: CommandOf<'G92'>, job: Job): void => {
  const { x, y, z, e } = command;
  const { state } = job;
  const { positionShift } = state;
  const physical = job.resolvePosition();

  if (command.words.length <= 1) {
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

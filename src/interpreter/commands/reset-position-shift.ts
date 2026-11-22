import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Clears XYZ workspace offsets without moving; E is unchanged, following Marlin.
 * This does not implement M82/M83 extrusion-mode tracking.
 * @param _command - The untyped G92.1 node, unused: the command takes no words
 * @param job - Job instance to update
 * @remarks
 * Typed as an `unknown` node because gcode-ast has no `G92.1` union member
 * yet; the interpreter reaches it through its mnemonic. Nothing here reads the
 * command, so the type is a formality rather than a constraint.
 * @see https://github.com/MarlinFirmware/Marlin/blob/922aa6619128928da3523f88c528d71c49756169/Marlin/src/gcode/geometry/G92.cpp#L36-L42
 */
export const resetPositionShift = (_command: CommandOf<'unknown'>, job: Job): void => {
  const { positionShift } = job.state;
  positionShift.x = 0;
  positionShift.y = 0;
  positionShift.z = 0;
};

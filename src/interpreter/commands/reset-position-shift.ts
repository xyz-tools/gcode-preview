import type { CommandHandler } from '../../interpreter';

/**
 * Clears XYZ workspace offsets without moving; E is unchanged, following Marlin.
 * This does not implement M82/M83 extrusion-mode tracking.
 * @see https://github.com/MarlinFirmware/Marlin/blob/922aa6619128928da3523f88c528d71c49756169/Marlin/src/gcode/geometry/G92.cpp#L36-L42
 */
export const resetPositionShift: CommandHandler = (command, job) => {
  const { positionShift } = job.state;
  positionShift.x = 0;
  positionShift.y = 0;
  positionShift.z = 0;
};

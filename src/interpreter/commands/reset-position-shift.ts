import type { CommandHandler } from '../../interpreter';

/** Clears all G92 offsets without moving the printhead or extruder. */
export const resetPositionShift: CommandHandler = (command, job) => {
  const { positionShift } = job.state;
  positionShift.x = 0;
  positionShift.y = 0;
  positionShift.z = 0;
  positionShift.e = 0;
};

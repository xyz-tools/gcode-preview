import type { CommandHandler } from '../../interpreter';

/** Clears G92 workspace offsets without moving the printhead or resetting E. */
export const resetPositionShift: CommandHandler = (command, job) => {
  const { positionShift } = job.state;
  positionShift.x = 0;
  positionShift.y = 0;
  positionShift.z = 0;
};

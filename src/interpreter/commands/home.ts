import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G28 homing command
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 * @remarks
 * Moves all axes to their home positions (0,0,0) and marks the state as homed,
 * so the position is now known rather than assumed.
 */
export const home: CommandHandler = (command, job) => {
  job.state.x = 0;
  job.state.y = 0;
  job.state.z = 0;
  job.state.isHomed = true;
};

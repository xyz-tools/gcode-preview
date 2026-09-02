import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G90 command to set motion commands to use absolute coordinates
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setAbsolutePositioning: CommandHandler = (command, job) => {
  job.state.positioning = 'absolute';
};

/**
 * Executes a G91 command to set motion commands to use coordinates relative
 * to the current position
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setRelativePositioning: CommandHandler = (command, job) => {
  job.state.positioning = 'relative';
};

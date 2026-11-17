import type { CommandHandler } from '../../interpreter';

/**
 * Executes a G90 command to select absolute XYZ and E coordinates
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setAbsolutePositioning: CommandHandler = (command, job) => {
  job.state.positioning = 'absolute';
  job.state.relativeExtrusion = false;
};

/**
 * Executes a G91 command to select relative XYZ and E coordinates
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setRelativePositioning: CommandHandler = (command, job) => {
  job.state.positioning = 'relative';
  job.state.relativeExtrusion = true;
};

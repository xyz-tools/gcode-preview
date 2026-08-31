import { CommandHandler } from '../shared';

/**
 * Executes a G20 command to set units to inches
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setInchUnits: CommandHandler = (command, job) => {
  job.state.units = 'in';
};

/**
 * Executes a G21 command to set units to millimeters
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 */
export const setMillimeterUnits: CommandHandler = (command, job) => {
  job.state.units = 'mm';
};

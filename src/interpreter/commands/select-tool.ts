import type { CommandHandler } from '../../interpreter';

/**
 * Executes a tool selection command (T0-T7)
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 * @remarks
 * Updates the job state to use the tool numbered in the command's gcode
 * (e.g. `t3` selects tool 3). Tools are typically used for multi-extruder
 * setups or different print heads. The registry decides which tool numbers
 * are supported; this handler assumes a `t<number>` gcode.
 */
export const selectTool: CommandHandler = (command, job) => {
  job.state.tool = parseInt(command.gcode.slice(1), 10);
};

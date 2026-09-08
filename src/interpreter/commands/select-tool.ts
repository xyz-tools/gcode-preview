import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Executes a tool selection command
 * @param command - The typed tool-change node
 * @param job - Job instance to update
 * @remarks
 * Reads the tool number off the node rather than off the mnemonic, so every
 * tool index works. The previous registry enumerated `t0`-`t7`, which silently
 * ignored `T8` and above on machines that have them.
 */
export const selectTool = (command: CommandOf<'T'>, job: Job): void => {
  job.state.tool = command.index;
};

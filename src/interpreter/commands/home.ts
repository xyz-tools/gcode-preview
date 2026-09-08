import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Executes a G28 homing command
 * @param command - The typed G28 node
 * @param job - Job instance to update
 * @remarks
 * Moves all axes to their home positions (0,0,0) and marks the state as homed,
 * so the position is now known rather than assumed. The node's per-axis flags
 * are deliberately ignored: a partial `G28 X` still homes everything here, as
 * it always has.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const home = (command: CommandOf<'G28'>, job: Job): void => {
  job.state.x = 0;
  job.state.y = 0;
  job.state.z = 0;
  job.state.isHomed = true;
};

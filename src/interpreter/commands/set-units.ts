import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Executes a G20/G21 unit change
 * @param command - The typed G20 or G21 node
 * @param job - Job instance to update
 * @remarks
 * One handler for both codes: the node already carries which unit it selects,
 * so there is nothing left for two handlers to disagree about.
 */
export const setUnits = (command: CommandOf<'G20' | 'G21'>, job: Job): void => {
  job.state.units = command.units === 'inches' ? 'in' : 'mm';
};

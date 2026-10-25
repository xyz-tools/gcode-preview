import type { CommandHandler } from '../../interpreter';

/**
 * Executes a pause command (M400 with a U parameter)
 * @param command - GCodeCommand containing the command
 * @param job - Job instance to update
 * @remarks
 * `M400 U<ms>` waits for the planner to drain and then pauses for user
 * interaction — a manual filament change, or inserting an object into the
 * print. Everything printed after it belongs to the next print segment, which
 * the renderer can draw in its own color.
 *
 * A bare `M400` is a plain "wait for moves to finish" that slicers emit
 * routinely, so only the U form starts a new segment.
 */
export const pause: CommandHandler = (command, job) => {
  if (command.params.u === undefined) return;
  job.state.segmentIndex++;
};

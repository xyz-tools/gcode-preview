import { GCodeCommand } from './parser/gcode-parser';
import { Job } from './job';
import { linearMove } from './interpreter/commands/linear-move';
import { arcMove } from './interpreter/commands/arc-move';
import { setInchUnits, setMillimeterUnits } from './interpreter/commands/set-units';
import { home } from './interpreter/commands/home';
import { selectTool } from './interpreter/commands/select-tool';

/**
 * Executes a single G-code command against a job
 * @param command - GCodeCommand to execute
 * @param job - Job instance to update
 * @remarks
 * Everything a handler needs — state, stats, and path bookkeeping like
 * `breakPath`/`resolvePosition` — lives on the job. Handlers import this type
 * with a type-only import, so registering them here does not create a circular
 * runtime dependency.
 */
export type CommandHandler = (command: GCodeCommand, job: Job) => void;

/**
 * Maps a lowercase gcode (e.g. `g1`) to the handler that executes it
 * @remarks
 * Commands without an entry here are ignored by the interpreter. To support a
 * new command, add its handler under `interpreter/commands/` and register it
 * in this map.
 */
export const handlers: ReadonlyMap<string, CommandHandler> = new Map<string, CommandHandler>([
  ['g0', linearMove],
  ['g1', linearMove],
  ['g2', arcMove],
  ['g3', arcMove],
  ['g20', setInchUnits],
  ['g21', setMillimeterUnits],
  ['g28', home],
  ['t0', selectTool],
  ['t1', selectTool],
  ['t2', selectTool],
  ['t3', selectTool],
  ['t4', selectTool],
  ['t5', selectTool],
  ['t6', selectTool],
  ['t7', selectTool]
]);

/**
 * Interprets and executes G-code commands, updating the job state accordingly
 *
 * @remarks
 * This class looks up each command in the handler registry and executes it,
 * translating commands into movements and state changes in the print job. It
 * supports common G-code commands including linear moves (G0/G1), arcs (G2/G3),
 * unit changes (G20/G21), and tool selection. Commands without a registered
 * handler are ignored.
 */
export class Interpreter {
  /**
   * Executes an array of G-code commands, updating the provided job
   * @param commands - Array of GCodeCommand objects to execute
   * @param job - Job instance to update (default: new Job)
   * @returns The updated job instance
   */
  execute(commands: GCodeCommand[], job = new Job()): Job {
    job.resumeLastPath();
    commands.forEach((command) => {
      const handler = handlers.get(command.gcode);
      handler?.(command, job);
    });
    job.finishPath();

    return job;
  }
}

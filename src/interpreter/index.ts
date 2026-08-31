import { GCodeCommand } from '../parser/gcode-parser';
import { Job } from '../job';
import { handlers } from './registry';
import { InterpreterContext } from './shared';

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
export class Interpreter implements InterpreterContext {
  // TODO: maybe these props should move to the Job class
  public retractions = 0;
  public deretractions = 0;
  public feedrateChanges = 0;
  public others = 0;
  public points = 0; // for reference, how many points were added to the job
  public extrusionDistance = 0;

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
      handler?.(command, job, this);
    });
    job.finishPath();

    return job;
  }
}

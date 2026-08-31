import { Path, PathType } from './path';
import { GCodeCommand } from './parser/gcode-parser';
import { Job } from './job';
import { State } from './state';
import { linearMove } from './interpreter/commands/linear-move';
import { arcMove } from './interpreter/commands/arc-move';
import { setInchUnits, setMillimeterUnits } from './interpreter/commands/set-units';
import { home } from './interpreter/commands/home';
import { selectTool } from './interpreter/commands/select-tool';

/**
 * What the command handlers get from the interpreter while executing a job:
 * helpers for path bookkeeping
 *
 * @remarks
 * Implemented by the `Interpreter`, which passes itself to every handler.
 * Handlers depend on this interface (a type-only import) rather than on the
 * interpreter module itself, so registering them here does not create a
 * circular runtime dependency.
 */
export interface InterpreterContext {
  /**
   * Resolves a state's position for rendering.
   * @param state - Current job state
   * @returns The position as concrete `x`, `y`, `z` numbers
   * @remarks
   * An axis that has not been homed has an unknown (`undefined`) position. The
   * interpreter chooses to assume the origin (`0`) for such axes so the viewer can
   * still render best-effort (see #361); `state.isHomed` lets a consumer tell these
   * assumed coordinates from real ones.
   */
  resolvePosition(state: State): { x: number; y: number; z: number };

  /**
   * Creates a new path and sets it as the current in-progress path
   * @param job - Job instance to update
   * @param newType - Type of the new path
   * @returns The newly created path
   * @remarks
   * This method is called when a path type change is detected (e.g. switching
   * between travel and extrusion moves). It finalizes the current path and
   * starts a new one of the specified type.
   */
  breakPath(job: Job, newType: PathType): Path;
}

/**
 * Executes a single G-code command against a job
 * @param command - GCodeCommand to execute
 * @param job - Job instance to update
 * @param context - Interpreter context to report counters into
 */
export type CommandHandler = (command: GCodeCommand, job: Job, context: InterpreterContext) => void;

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
export class Interpreter implements InterpreterContext {
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

  /** {@inheritDoc InterpreterContext.resolvePosition} */
  resolvePosition(state: State): { x: number; y: number; z: number } {
    return { x: state.x ?? 0, y: state.y ?? 0, z: state.z ?? 0 };
  }

  /** {@inheritDoc InterpreterContext.breakPath} */
  breakPath(job: Job, newType: PathType): Path {
    job.finishPath();
    const currentPath = new Path(newType, 0.6, 0.2, job.state.tool);
    const pos = this.resolvePosition(job.state);
    currentPath.addPoint(pos.x, pos.y, pos.z);
    job.inprogressPath = currentPath;
    return currentPath;
  }
}

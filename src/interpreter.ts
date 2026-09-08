import type { Command, CommandOf, CommandType } from 'gcode-ast';
import { GCodeCommand } from './parser/gcode-parser';
import { Job } from './job';
import {
  linearMove,
  arcMove,
  makeArcMove,
  setUnits,
  home,
  setPosition,
  probe,
  selectTool
} from './interpreter/commands';

/** Options for the {@link Interpreter} */
export interface InterpreterOptions {
  /**
   * Maximum deviation, in millimeters, between tessellated G2/G3 arc chords
   * and the true arc (default 0.05). Lower values produce smoother arcs at
   * the cost of more geometry.
   */
  arcChordTolerance?: number;
}

/**
 * Maps a command type to the handler that executes it.
 *
 * @remarks
 * The value type is written out per key rather than through an aliased generic
 * on purpose: TypeScript measures variance on the alias and then rejects a
 * handler covering `'G0' | 'G1'` in the `G0` slot, even though it accepts
 * strictly more. Spelled inline, the check is structural and a handler may
 * cover as many types as it likes.
 *
 * A type without an entry is ignored, which is how everything from `M104` to a
 * Klipper macro passes through without a handler for it.
 */
export type HandlerRegistry = {
  [K in CommandType]?: (command: CommandOf<K>, job: Job) => void;
};

/**
 * The handlers this interpreter executes, keyed by the AST's command type.
 * @remarks
 * To support a new command, add its handler under `interpreter/commands/` and
 * register it here. The key is checked against the AST's union, so a typo or a
 * command the parser does not produce is a compile error rather than a handler
 * that silently never runs.
 */
export const handlers: HandlerRegistry = {
  G0: linearMove,
  G1: linearMove,
  G2: arcMove,
  G3: arcMove,
  G20: setUnits,
  G21: setUnits,
  G28: home,
  G31: probe,
  'G38.2': probe,
  'G38.3': probe,
  'G38.4': probe,
  'G38.5': probe,
  G92: setPosition,
  T: selectTool
};

/**
 * Interprets and executes G-code commands, updating the job state accordingly
 *
 * @remarks
 * This class looks up each command's AST node in the handler registry and
 * executes it, translating commands into movements and state changes in the
 * print job. It supports linear moves (G0/G1), arcs (G2/G3), unit changes
 * (G20/G21), homing (G28), probing (G31, G38.2-G38.5), position setting (G92)
 * and tool selection (T). Commands without a registered handler are ignored.
 */
export class Interpreter {
  private handlers: HandlerRegistry;

  /**
   * Creates an interpreter, optionally with custom arc tessellation
   * @param options - Interpreter options
   * @remarks
   * A custom arcChordTolerance swaps the shared G2/G3 handler for one built
   * around its own tessellator; every other command keeps the shared registry.
   */
  constructor(options: InterpreterOptions = {}) {
    if (options.arcChordTolerance === undefined) {
      this.handlers = handlers;
    } else {
      const customArcMove = makeArcMove({ chordTolerance: options.arcChordTolerance });
      this.handlers = { ...handlers, G2: customArcMove, G3: customArcMove };
    }
  }

  /**
   * Executes an array of G-code commands, updating the provided job
   * @param commands - Array of GCodeCommand objects to execute
   * @param job - Job instance to update (default: new Job)
   * @returns The updated job instance
   * @remarks
   * Dispatch reads the typed AST node the parser attached, so a command the
   * parser could not type (and a blank or comment-only line, which has no node
   * at all) is skipped here.
   */
  execute(commands: GCodeCommand[], job = new Job()): Job {
    job.resumeLastPath();
    commands.forEach((command) => {
      const node = command.node;
      if (node === undefined) return;
      // One lookup, then a call the registry's mapped type cannot express to
      // the compiler: the key and the argument are the same node, but that
      // correlation is only knowable at runtime.
      const handler = this.handlers[node.type] as ((command: Command, job: Job) => void) | undefined;
      handler?.(node, job);
    });
    job.finishPath();

    return job;
  }
}

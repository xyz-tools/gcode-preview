import { CommandHandler } from './shared';
import { linearMove } from './commands/linear-move';
import { arcMove } from './commands/arc-move';
import { setInchUnits, setMillimeterUnits } from './commands/set-units';
import { home } from './commands/home';
import { selectTool } from './commands/select-tool';

/**
 * Maps a lowercase gcode (e.g. `g1`) to the handler that executes it
 * @remarks
 * Commands without an entry here are ignored by the interpreter. To support a
 * new command, add its handler under `commands/` and register it in this map.
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

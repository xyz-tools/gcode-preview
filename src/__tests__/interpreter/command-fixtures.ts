import { test, expect, describe } from 'vitest';
import { parseLine, type CommandOf, type CommandType } from 'gcode-ast';
import { GCodeCommand, Parser } from '../../parser/gcode-parser';

/**
 * Parses one line of G-code into the typed AST node the interpreter dispatches
 * on.
 *
 * Handler tests used to hand-build a command from a mnemonic and a params bag,
 * which let a test assert on a shape the parser would never actually produce.
 * Going through the real parser costs nothing and keeps them honest.
 */
export function cmd<K extends CommandType>(line: string): CommandOf<K> {
  const node = parseLine(line).line.command;
  if (node === undefined) {
    throw new Error(`No command parsed from ${JSON.stringify(line)}`);
  }
  return node as CommandOf<K>;
}

describe('cmd', () => {
  test('returns the typed node for a line', () => {
    const move = cmd<'G1'>('G1 X1 Y2 E3');

    expect(move.type).toEqual('G1');
    expect(move.x).toEqual(1);
    expect(move.y).toEqual(2);
    expect(move.e).toEqual(3);
  });

  test('throws on a line that carries no command', () => {
    expect(() => cmd('; just a comment')).toThrow('No command parsed');
  });
});

/**
 * Parses one line into the {@link GCodeCommand} the interpreter consumes,
 * typed node attached. Use this for `Interpreter.execute`, which walks parser
 * output; use {@link cmd} when calling a handler directly.
 */
export function parsed(line: string): GCodeCommand {
  return new Parser().parseCommand(line) as GCodeCommand;
}

describe('parsed', () => {
  test('carries the typed node the interpreter dispatches on', () => {
    expect(parsed('G1 X1').node?.type).toEqual('G1');
  });
});

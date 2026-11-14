import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, describe } from 'vitest';

import { splitChunk } from '../helpers/split-chunk';
import { Parser } from '../parser/gcode-parser';

describe('splitChunk', () => {
  test('keeps the newline out of the tail', () => {
    const { complete, tail } = splitChunk('', 'G1 X0\nG1 X1\nG1 X');

    expect(complete).toEqual('G1 X0\nG1 X1');
    expect(tail).toEqual('G1 X');
  });

  test('prepends the previous tail to the complete lines', () => {
    const { complete, tail } = splitChunk('G1 X', '2\nG1 X3\nG1 X4');

    expect(complete).toEqual('G1 X2\nG1 X3');
    expect(tail).toEqual('G1 X4');
  });

  test('a chunk ending on a newline leaves an empty tail', () => {
    const { complete, tail } = splitChunk('', 'G1 X0\nG1 X1\n');

    expect(complete).toEqual('G1 X0\nG1 X1');
    expect(tail).toEqual('');
  });

  test('a chunk with no newline carries fully into the tail', () => {
    // Without a newline nothing is complete yet: the whole chunk joins the
    // tail so no line is ever handed to the parser truncated.
    const { complete, tail } = splitChunk('G1 ', 'X42');

    expect(complete).toEqual('');
    expect(tail).toEqual('G1 X42');
  });
});

describe('streaming across a chunk boundary', () => {
  test('a boundary that splits a line mid-way injects no empty line', () => {
    // Mirrors readStream: each chunk is split into complete lines, which are
    // parsed, and a tail carried into the next chunk. The boundary here falls
    // in the middle of 'G1 X2'.
    const chunks = ['G1 X0\nG1 X1\nG1 X', '2\nG1 X3\nG1 X4'];

    const parser = new Parser({ keepLines: true });
    let tail = '';
    for (const chunk of chunks) {
      const split = splitChunk(tail, chunk);
      tail = split.tail;
      parser.parseGCode(split.complete);
    }
    parser.parseGCode(tail);

    expect(parser.lines).toEqual(['G1 X0', 'G1 X1', 'G1 X2', 'G1 X3', 'G1 X4']);
    expect(parser.lines).not.toContain('');
    expect(parser.lineCount).toEqual(5);
  });

  test('1-character chunks plus a final flush reconstruct every line intact', () => {
    // Worst-case chunking: every read delivers a single character. Each line
    // must still reach the parser whole, never split mid-line.
    const source = 'G1 X0\nG1 X1\nG1 X42';

    const parser = new Parser({ keepLines: true });
    let tail = '';
    for (const chunk of source) {
      const split = splitChunk(tail, chunk);
      tail = split.tail;
      if (split.complete !== '') parser.parseGCode(split.complete);
    }
    parser.parseGCode(tail);

    expect(parser.lines).toEqual(['G1 X0', 'G1 X1', 'G1 X42']);
    expect(parser.lineCount).toEqual(3);
  });

  test('carries a trailing comment run into the next chunk', () => {
    // A slicer describes a layer in a run of comments. Handing over half of
    // one leaves whatever reads them looking at a layer whose values are in
    // the next chunk (#445), so the run waits for the line that closes it.
    const { complete, tail } = splitChunk('', 'G1 X0\n;LAYER_CHANGE\n;Z:0.2\n');

    expect(complete).toEqual('G1 X0');
    expect(tail).toEqual(';LAYER_CHANGE\n;Z:0.2\n');
  });

  test('releases the held comments once a G-code line closes the run', () => {
    const { complete, tail } = splitChunk(';LAYER_CHANGE\n;Z:0.2\n', 'G1 Z0.2\nG1 X1');

    expect(complete).toEqual(';LAYER_CHANGE\n;Z:0.2\nG1 Z0.2');
    expect(tail).toEqual('G1 X1');
  });

  test('holds a chunk that is nothing but comments', () => {
    const { complete, tail } = splitChunk('', ';LAYER_CHANGE\n;Z:0.2\n');

    expect(complete).toEqual('');
    expect(tail).toEqual(';LAYER_CHANGE\n;Z:0.2\n');
  });

  test('keeps a comment that shares its line with a command', () => {
    // The line carries G-code, so it ends the run rather than joining it.
    const { complete, tail } = splitChunk('', 'G28 ; home all axes\nG1 X1');

    expect(complete).toEqual('G28 ; home all axes');
    expect(tail).toEqual('G1 X1');
  });

  test('a held run keeps the newline that terminated it', () => {
    // Dropping it would glue the next chunk's first characters onto the last
    // held line; only the unterminated partial line ends the tail without one.
    const first = splitChunk('', 'G1 X0\n;Z:0.2\n');
    const second = splitChunk(first.tail, 'G1 X1\n');

    expect(second.complete).toEqual(';Z:0.2\nG1 X1');
  });

  test('1-character chunks keep a comment block whole', () => {
    const source = 'G1 X0\n;LAYER_CHANGE\n;Z:0.2\nG1 Z0.2';

    const parser = new Parser({ keepLines: true });
    let tail = '';
    for (const chunk of source) {
      const split = splitChunk(tail, chunk);
      tail = split.tail;
      if (split.complete !== '') parser.parseGCode(split.complete);
    }
    parser.parseGCode(tail);

    expect(parser.lines).toEqual(['G1 X0', ';LAYER_CHANGE', ';Z:0.2', 'G1 Z0.2']);
  });
});

describe('Quint spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/streaming.qnt against
  // the real splitChunk. Each trace state records the chunk fed on that step
  // (chunkTaken), the lines the spec says the step completed (stepLines), the
  // cumulative emitted lines (lines) and the carry buffer (carry), all as
  // token lists over the spec's 5-letter alphabet.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'streaming');

  // The spec's token alphabet, mapped 1:1 to characters (token = array index)
  const TOKEN_CHARS = ['a', 'b', ' ', ';', '\n'];

  // An ITF value: strings are plain JSON, lists are plain JSON arrays, and
  // integers arrive either as plain numbers or in Apalache's
  // { "#bigint": "123" } wrapping.
  type ItfValue = string | number | { '#bigint': string } | ItfValue[] | undefined;
  type ItfState = Record<string, ItfValue>;

  const itfInt = (value: ItfValue, key: string): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value['#bigint'] === 'string') {
      return Number(value['#bigint']);
    }
    throw new Error(`expected an ITF integer for "${key}", got ${JSON.stringify(value)}`);
  };
  const itfStr = (value: ItfValue, key: string): string => {
    if (typeof value !== 'string') throw new Error(`expected a string for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };
  const itfList = (value: ItfValue, key: string): ItfValue[] => {
    if (!Array.isArray(value)) throw new Error(`expected an ITF list for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };
  /** A token list decoded into the string it stands for */
  const itfText = (value: ItfValue, key: string): string =>
    itfList(value, key)
      .map((token, i) => {
        const char = TOKEN_CHARS[itfInt(token, `${key}[${i}]`)];
        if (char === undefined) throw new Error(`token out of alphabet at "${key}[${i}]"`);
        return char;
      })
      .join('');
  /** A list of token lists decoded into an array of line strings */
  const itfLines = (value: ItfValue, key: string): string[] =>
    itfList(value, key).map((line, i) => itfText(line, `${key}[${i}]`));

  // The spec's state variables, decoded; keys starting with '#' (like '#meta')
  // are never read and are thereby ignored.
  type SpecState = {
    cmd: string;
    chunkTaken: string;
    stepLines: string[];
    doc: string;
    cursor: number;
    carry: string;
    lines: string[];
  };

  const decodeState = (raw: ItfState): SpecState => ({
    cmd: itfStr(raw.cmd, 'cmd'),
    chunkTaken: itfText(raw.chunkTaken, 'chunkTaken'),
    stepLines: itfLines(raw.stepLines, 'stepLines'),
    doc: itfText(raw.doc, 'doc'),
    cursor: itfInt(raw.cursor, 'cursor'),
    carry: itfText(raw.carry, 'carry'),
    lines: itfLines(raw.lines, 'lines')
  });

  let traceFiles: string[] = [];
  try {
    traceFiles = readdirSync(tracesDir)
      .filter((file) => file.endsWith('.itf.json'))
      .sort();
  } catch {
    // Missing directory: the guard test below fails with a clear message.
  }

  test('the traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    test(`replays ${traceFile} through splitChunk`, () => {
      const parsed = JSON.parse(readFileSync(join(tracesDir, traceFile), 'utf8')) as { states: ItfState[] };
      expect(Array.isArray(parsed.states), `${traceFile}: ITF file has no states array`).toBe(true);
      expect(parsed.states.length, `${traceFile}: trace has no states`).toBeGreaterThan(0);
      const states = parsed.states.map(decodeState);

      expect(states[0].cmd, `${traceFile} step 0: the first state must be the init state`).toBe('init');
      expect(states[0].carry, `${traceFile} step 0: the carry must start empty`).toBe('');
      expect(states[0].lines, `${traceFile} step 0: no lines may be emitted yet`).toEqual([]);

      // The real splitter's running state, built only from its own outputs.
      let tail = '';
      const emitted: string[] = [];
      let consumed = '';

      for (let step = 1; step < states.length; step++) {
        const spec = states[step];
        // A stutter records that the document was exhausted: nothing is fed.
        if (spec.cmd === 'stutter') continue;
        expect(spec.cmd, `${traceFile} step ${step}: unknown spec command "${spec.cmd}"`).toBe('chunk');

        const at = (field: string, expected: unknown, actual: unknown): string =>
          `${traceFile} step ${step} (chunk ${JSON.stringify(spec.chunkTaken)}) field ${field}: ` +
          `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`;

        const { complete, tail: nextTail } = splitChunk(tail, spec.chunkTaken);

        // splitChunk's contract: tail + chunk == complete + sep + nextTail,
        // where sep is the one consumed newline, or nothing when no line
        // completed. The spec records one line per consumed separator, so an
        // empty `complete` that still consumed a newline is one empty line.
        const sepLength = tail.length + spec.chunkTaken.length - complete.length - nextTail.length;
        expect(sepLength === 0 || sepLength === 1, at('separator', '0 or 1', sepLength)).toBe(true);
        if (sepLength === 0) expect(complete, at('complete', '', complete)).toBe('');

        const stepLines = sepLength === 1 ? complete.split('\n') : [];
        expect(stepLines, at('stepLines', spec.stepLines, stepLines)).toEqual(spec.stepLines);
        expect(nextTail, at('carry', spec.carry, nextTail)).toBe(spec.carry);

        emitted.push(...stepLines);
        expect(emitted, at('lines', spec.lines, emitted)).toEqual(spec.lines);

        consumed += spec.chunkTaken;
        const docPrefix = spec.doc.slice(0, spec.cursor);
        expect(consumed, at('consumed doc prefix', docPrefix, consumed)).toBe(docPrefix);

        tail = nextTail;
      }
    });
  }
});

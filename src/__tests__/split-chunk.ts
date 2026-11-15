import { join } from 'node:path';
import { test, expect, describe } from 'vitest';

import { splitChunk } from '../helpers/split-chunk';
import { Parser } from '../parser/gcode-parser';
import { listTraceFiles, readTrace, itfInt, itfStr, itfList, itfRecord, type ItfValue } from './helpers/itf-replay';

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

describe('streaming spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/streaming.qnt
  // against the real splitChunk. Each trace state holds exactly two records:
  // `s` (the machine state: doc, cursor, carry, cumulative lines) and `ev`
  // (the step's event: kind, the chunk fed, the lines it completed). Tokens
  // map 1:1 to characters, so a trace doubles as a chunking schedule whose
  // exact chunk strings drive the real splitter. All numbers here are token
  // counts, compared integer-exactly with ===; nothing is scaled.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'streaming');

  // The spec's token alphabet, mapped 1:1 to characters (token = array index);
  // keep in sync with streaming.qnt's header and streaming.md.
  const TOKEN_CHARS = ['a', 'b', ' ', ';', '\n'];

  /** A token list decoded into the string it stands for */
  const tokenText = (value: ItfValue | undefined, key: string): string =>
    itfList(value, key)
      .map((token, i) => {
        const char = TOKEN_CHARS[itfInt(token, `${key}[${i}]`)];
        if (char === undefined) throw new Error(`token out of alphabet at "${key}[${i}]"`);
        return char;
      })
      .join('');

  /** A list of token lists decoded into an array of line strings */
  const tokenLines = (value: ItfValue | undefined, key: string): string[] =>
    itfList(value, key).map((line, i) => tokenText(line, `${key}[${i}]`));

  // The decoded step: the semantic fields the replay compares. The spec's
  // model-internal ghosts (phase, prevCursor) are deliberately not decoded.
  type SpecStep = {
    kind: string;
    chunk: string;
    emitted: string[];
    doc: string;
    cursor: number;
    carry: string;
    lines: string[];
  };

  const decodeStep = (raw: Record<string, ItfValue>): SpecStep => {
    const s = itfRecord(raw.s, 's');
    const ev = itfRecord(raw.ev, 'ev');
    return {
      kind: itfStr(ev.kind, 'ev.kind'),
      chunk: tokenText(ev.chunk, 'ev.chunk'),
      emitted: tokenLines(ev.emitted, 'ev.emitted'),
      doc: tokenText(s.doc, 's.doc'),
      cursor: itfInt(s.cursor, 's.cursor'),
      carry: tokenText(s.carry, 's.carry'),
      lines: tokenLines(s.lines, 's.lines')
    };
  };

  /** The spec's emitted-line accounting applied to a real splitChunk call:
   * exactly one newline is consumed per completing step, so `complete` split
   * on '\n' is the step's lines (an empty completion that still consumed a
   * separator is one empty line), and no separator means no lines. */
  const realStepLines = (fedLength: number, complete: string, nextTail: string): string[] => {
    const sepLength = fedLength - complete.length - nextTail.length;
    if (sepLength !== 0 && sepLength !== 1) {
      throw new Error(`splitChunk consumed ${sepLength} separators; the accounting expects 0 or 1`);
    }
    if (sepLength === 0 && complete !== '') {
      throw new Error(`splitChunk completed ${JSON.stringify(complete)} without consuming a separator`);
    }
    return sepLength === 1 ? complete.split('\n') : [];
  };

  const traceFiles = listTraceFiles(tracesDir);

  test('the v2 traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces/streaming.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    test(`replays ${traceFile} through splitChunk`, () => {
      const states = readTrace(tracesDir, traceFile).map(decodeStep);

      expect(states[0].kind, `${traceFile} step 0: the first state must be the init state`).toBe('init');
      expect(states[0].carry, `${traceFile} step 0: the carry must start empty`).toBe('');
      expect(states[0].lines, `${traceFile} step 0: no lines may be emitted yet`).toEqual([]);

      // The real splitter's running state, built only from its own outputs.
      let tail = '';
      const emitted: string[] = [];
      let consumed = '';
      let confluenceChecked = false;

      for (let step = 1; step < states.length; step++) {
        const spec = states[step];
        // A stutter records that the document was exhausted: nothing is fed.
        if (spec.kind === 'stutter') continue;
        expect(spec.kind, `${traceFile} step ${step}: unknown spec event kind "${spec.kind}"`).toBe('chunk');

        const at = (field: string, expected: unknown, actual: unknown): string =>
          `${traceFile} step ${step} (chunk ${JSON.stringify(spec.chunk)}) field ${field}: ` +
          `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`;

        const { complete, tail: nextTail } = splitChunk(tail, spec.chunk);
        const stepLines = realStepLines(tail.length + spec.chunk.length, complete, nextTail);

        expect(stepLines, at('ev.emitted', spec.emitted, stepLines)).toEqual(spec.emitted);
        expect(nextTail, at('s.carry', spec.carry, nextTail)).toBe(spec.carry);

        emitted.push(...stepLines);
        expect(emitted, at('s.lines', spec.lines, emitted)).toEqual(spec.lines);

        consumed += spec.chunk;
        expect(consumed.length, at('s.cursor', spec.cursor, consumed.length)).toBe(spec.cursor);
        expect(consumed, at('consumed doc prefix', spec.doc.slice(0, spec.cursor), consumed)).toBe(
          spec.doc.slice(0, spec.cursor)
        );

        tail = nextTail;

        // Terminal confluence, replayed on the real splitter: once the whole
        // document has been fed under the trace's chunking, the emitted lines
        // and the carry must equal a oneshot split of the document.
        if (spec.cursor === spec.doc.length) {
          const oneshot = splitChunk('', spec.doc);
          const oneshotLines = realStepLines(spec.doc.length, oneshot.complete, oneshot.tail);
          expect(emitted, at('oneshot lines', oneshotLines, emitted)).toEqual(oneshotLines);
          expect(tail, at('oneshot carry', oneshot.tail, tail)).toBe(oneshot.tail);
          confluenceChecked = true;
        }
      }

      // Traces whose document outlives the step budget legitimately skip the
      // confluence check; those that exhausted must have performed it.
      const lastState = states[states.length - 1];
      if (lastState.cursor === lastState.doc.length) {
        expect(confluenceChecked, `${traceFile}: exhausted trace never ran the confluence check`).toBe(true);
      }
    });
  }
});

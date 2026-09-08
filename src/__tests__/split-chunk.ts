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

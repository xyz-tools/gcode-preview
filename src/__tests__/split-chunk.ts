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
});

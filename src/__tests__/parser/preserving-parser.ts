import { test, expect, describe } from 'vitest';

import { Parser } from '../../parser/gcode-parser';

describe('with keepLines', () => {
  test('all input should be preserved', () => {
    const parser = new Parser({ keepLines: true });
    const gcode = `G1 X0 Y0 Z1 E1`;
    const parsed = parser.parseGCode(gcode);
    expect(parsed).not.toBeNull();
    const unparsed = parser.lines.join('\n');
    expect(unparsed).toEqual(gcode);
  });

  test('multiple lines should be preserved', () => {
    const parser = new Parser({ keepLines: true });
    const gcode = `G1 X0 Y0 Z1 E1\nG1 X10 Y10 E10`;
    const parsed = parser.parseGCode(gcode);
    expect(parsed).not.toBeNull();
    const unparsed = parser.lines.join('\n');
    expect(unparsed).toEqual(gcode);
  });

  test('comments should be preserved', () => {
    const parser = new Parser({ keepLines: true });
    const gcode = `G1 X0 Y0 Z1 E1; this is a comment`;
    const parsed = parser.parseGCode(gcode);
    expect(parsed).not.toBeNull();
    const unparsed = parser.lines.join('\n');
    expect(unparsed).toEqual(gcode);
  });

  test('input parsed in chunks should be preserved whole', () => {
    // A streaming parse calls parseGCode once per chunk. Preserving only the
    // most recent chunk would make the option useless for the large files it
    // exists for.
    const parser = new Parser({ keepLines: true });
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1');
    parser.parseGCode('G1 X2 Y2\nG1 X3 Y3');

    expect(parser.lines).toEqual(['G1 X0 Y0', 'G1 X1 Y1', 'G1 X2 Y2', 'G1 X3 Y3']);
  });

  test('a trailing newline does not preserve a phantom empty line', () => {
    // A newline terminates a line; it does not begin an empty one. The
    // streaming path never records that phantom line, so the whole-string
    // path must not either.
    const parser = new Parser({ keepLines: true });
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1\n');

    expect(parser.lines).toEqual(['G1 X0 Y0', 'G1 X1 Y1']);
  });

  test('mid-file blank lines are preserved', () => {
    const parser = new Parser({ keepLines: true });
    parser.parseGCode('G1 X0 Y0\n\nG1 X1 Y1\n');

    expect(parser.lines).toEqual(['G1 X0 Y0', '', 'G1 X1 Y1']);
  });

  test('a chunk is only turned into commands once', () => {
    const parser = new Parser({ keepLines: true });
    const first = parser.parseGCode('G1 X0 Y0\nG1 X1 Y1');
    const second = parser.parseGCode('G1 X2 Y2');

    expect(first.commands).toHaveLength(2);
    expect(second.commands).toHaveLength(1);
  });
});

describe('without keepLines', () => {
  test('the source is not retained', () => {
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0 Z1 E1\nG1 X10 Y10 E10');

    expect(parser.lines).toEqual([]);
  });

  test('parsing still returns the commands', () => {
    const parser = new Parser();
    const { commands } = parser.parseGCode('G1 X0 Y0\nG1 X1 Y1');

    expect(commands).toHaveLength(2);
    expect(commands[1].gcode).toEqual('g1');
  });
});

describe('lineCount', () => {
  test('counts the lines parsed', () => {
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1\nG1 X2 Y2');

    expect(parser.lineCount).toEqual(3);
  });

  test('accumulates across chunks', () => {
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1');
    parser.parseGCode('G1 X2 Y2');

    expect(parser.lineCount).toEqual(3);
  });

  test('is tracked even when the source is not kept', () => {
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1');

    expect(parser.lines).toEqual([]);
    expect(parser.lineCount).toEqual(2);
  });

  test('a newline-terminated file counts no phantom final line', () => {
    // Real slicer output ends in '\n'. Splitting on it used to leave a final
    // '' element, making whole-string parses one line longer than streamed
    // parses of the exact same bytes.
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0\nG1 X1 Y1\nG1 X2 Y2\n');

    expect(parser.lineCount).toEqual(3);
  });

  test('mid-file blank lines each count as one line', () => {
    const parser = new Parser();
    parser.parseGCode('G1 X0 Y0\n\nG1 X1 Y1\n');

    expect(parser.lineCount).toEqual(3);
  });

  test('an empty string parses to zero lines and zero commands', () => {
    // readStream hands parseGCode an empty `complete` when a chunk holds no
    // newline; it must be a no-op, not a phantom line per chunk.
    const parser = new Parser();
    const { commands } = parser.parseGCode('');

    expect(commands).toEqual([]);
    expect(parser.lineCount).toEqual(0);
  });

  test('an explicit array of lines is counted as given', () => {
    // Array input is already line-separated: nothing is dropped, even a
    // trailing empty element the caller chose to include.
    const parser = new Parser();
    parser.parseGCode(['G1 X0 Y0', '']);

    expect(parser.lineCount).toEqual(2);
  });
});

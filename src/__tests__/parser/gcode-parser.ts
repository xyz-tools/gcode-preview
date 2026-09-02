import { test, expect } from 'vitest';
import { GCodeCommand, Parser } from '../../parser/gcode-parser';

test('a single extrusion cmd should result in 1 command', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1`;
  const parsed = parser.parseGCode(gcode);
  expect(parsed).not.toBeNull();
  expect(parsed.commands).not.toBeNull();
  expect(parsed.commands.length).toEqual(1);
});

test('a single extrusion cmd should parse attributes', () => {
  const parser = new Parser();
  const gcode = `G1 X5 Y6 Z3 E1.9`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[0];
  expect(cmd.params.x).toEqual(5);
  expect(cmd.params.y).toEqual(6);
  expect(cmd.params.z).toEqual(3);
  expect(cmd.params.e).toEqual(1.9);
});

// G1 X61.769 Y90.734 E-.27245
test("E value that doesn' have a leading 0 should be parsed as if there was a 0", () => {
  const parser = new Parser();
  const gcode = `G1 X61.769 Y90.734 E-.27245`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[0];
  expect(cmd.params.x).toEqual(61.769);
  expect(cmd.params.y).toEqual(90.734);
  expect(cmd.params.e).toEqual(-0.27245);
});

test('multiple cmd results in an array of commands', () => {
  const parser = new Parser();
  const gcode = `G1 X5 Y6 Z3 E1.9
  G1 X6 Y6 E1.9
  G1 X5 Y7 E1.9`;
  const parsed = parser.parseGCode(gcode);
  expect(parsed.commands).not.toBeNull();
  expect(parsed.commands.length).toEqual(3);
});

test('T0 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T0`;
  const parsed = parser.parseGCode(gcode);
  expect(parsed).not.toBeNull();
  expect(parsed.commands).not.toBeNull();
  expect(parsed.commands.length).toEqual(2);

  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t0');
});

test('T1 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T1`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t1');
});

test('T2 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T2`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t2');
});

test('T3 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T3`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t3');
});

// repeat fot T4 .. T7
test('T4 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T4`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t4');
});

test('T5 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T5`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t5');
});

test('T6 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T6`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t6');
});

test('T7 command should result in a tool change', () => {
  const parser = new Parser();
  const gcode = `G1 X0 Y0 Z1 E1
  T7`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[1];
  expect(cmd.gcode).toEqual('t7');
});

test('gcode commands with spaces between letters and numbers should be parsed correctly', () => {
  const parser = new Parser();
  const gcode = `G 1 E 42 X 42`;
  const parsed = parser.parseGCode(gcode);
  const cmd = parsed.commands[0];
  expect(cmd.gcode).toEqual('g1');
  expect(cmd.params.x).toEqual(42);
  expect(cmd.params.e).toEqual(42);
});

// test that a line withouth a gcode command results in a command with empty string gcode
test('gcode commands without gcode should result in a command with empty string gcode', () => {
  const parser = new Parser();
  const gcode = ` ; comment`;
  const cmd = parser.parseCommand(gcode) as GCodeCommand;
  expect(cmd.gcode).toEqual('');
});

describe('parseCommand tokenizing', () => {
  const parse = (line: string) => new Parser().parseCommand(line) as GCodeCommand;

  test('reads a command and its parameters', () => {
    const cmd = parse('G1 X100.5 Y-20 E0.04 F1200');
    expect(cmd.gcode).toEqual('g1');
    expect(cmd.params).toEqual({ x: 100.5, y: -20, e: 0.04, f: 1200 });
  });

  test('lower-cases the command and the parameter letters', () => {
    const cmd = parse('G28 X0');
    expect(cmd.gcode).toEqual('g28');
    expect(cmd.params.x).toEqual(0);
  });

  test('keeps a fractional command number', () => {
    expect(parse('G28.1 X0').gcode).toEqual('g28.1');
  });

  test('tolerates missing whitespace between words', () => {
    const cmd = parse('G1X10Y20');
    expect(cmd.gcode).toEqual('g1');
    expect(cmd.params).toEqual({ x: 10, y: 20 });
  });

  test('keeps the src line verbatim', () => {
    const line = '  G1 X1 ; move  ';
    expect(parse(line).src).toEqual(line);
  });

  describe('comments', () => {
    test('splits the comment off the command', () => {
      const cmd = parse('G1 X1 ; move right');
      expect(cmd.gcode).toEqual('g1');
      expect(cmd.params.x).toEqual(1);
      expect(cmd.comment).toEqual('move right');
    });

    test('stops the comment at a second semicolon', () => {
      expect(parse('G1 X1 ; first ; second').comment).toEqual('first');
    });

    test('treats an empty comment as absent', () => {
      expect(parse('G1 X1 ;').comment).toBeUndefined();
    });

    test('treats a whitespace-only comment as absent', () => {
      expect(parse('G1 X1 ;   ').comment).toBeUndefined();
    });

    test('trims surrounding whitespace off the comment', () => {
      // Slicers write '; comment' with a space after the semicolon; consumers
      // (the slicer metadata parsers anchor patterns with ^) rely on the trim.
      expect(parse('G1 X1 ;   padded   ').comment).toEqual('padded');
    });

    test('parses no command from a comment-only line', () => {
      const cmd = parse('; just a comment');
      expect(cmd.gcode).toEqual('');
      expect(cmd.params).toEqual({});
      expect(cmd.comment).toEqual('just a comment');
    });

    test('drops the comment when asked to', () => {
      expect(new Parser().parseCommand('G1 X1 ; move', false)?.comment).toBeUndefined();
    });
  });

  describe('non-finite parameter values', () => {
    test('drops a param whose value is not a number', () => {
      // G1 Xabc used to yield params.x === NaN, which propagated all the way into
      // the bounding box and the camera frustum.
      const cmd = parse('G1 Xabc Y5 Z1');
      expect(cmd.gcode).toEqual('g1');
      expect(cmd.params.x).toBeUndefined();
      expect(cmd.params.y).toEqual(5);
      expect(cmd.params.z).toEqual(1);
    });

    test('drops a param with no value at all', () => {
      const cmd = parse('G1 X Y5');
      expect(cmd.params.x).toBeUndefined();
      expect(cmd.params.y).toEqual(5);
    });

    test('drops a param whose value overflows to Infinity', () => {
      // The tokenizer splits on letters, so exponent notation is not a route to
      // Infinity here; an absurdly long digit run is.
      const huge = '1' + '0'.repeat(400);
      const cmd = parse(`G1 X${huge} Y-${huge} Z2`);
      expect(cmd.params.x).toBeUndefined();
      expect(cmd.params.y).toBeUndefined();
      expect(cmd.params.z).toEqual(2);
    });

    test('takes the leading number and drops trailing letters', () => {
      // The tokenizer splits at the first letter, so X's value slice is '123' and the
      // trailing letters become valueless words that are now dropped rather than stored
      // as NaN. Lenient like the firmware: Marlin's strtod also ignores the tail.
      const cmd = parse('G1 X123abc Y5');
      expect(cmd.params).toEqual({ x: 123, y: 5 });
    });

    test('takes the leading number of a malformed decimal', () => {
      const cmd = parse('G1 X1.2.3 Y5');
      expect(cmd.params).toEqual({ x: 1.2, y: 5 });
    });

    test('keeps finite values of every shape', () => {
      const cmd = parse('G1 X-0.5 Y0 Z100 E-.27245');
      expect(cmd.params).toEqual({ x: -0.5, y: 0, z: 100, e: -0.27245 });
    });
  });

  test('produces an empty command for a blank line', () => {
    const cmd = parse('   ');
    expect(cmd.gcode).toEqual('');
    expect(cmd.params).toEqual({});
  });

  test('skips leading characters that are not letters', () => {
    // The tokenizer only opens a word at a letter, so anything before the
    // first letter (line numbers stripped of their N, checksum asterisks,
    // stray punctuation) is passed over without producing a command or param.
    const cmd = parse('*12 G1 X5');
    expect(cmd.gcode).toEqual('g1');
    expect(cmd.params).toEqual({ x: 5 });
  });

  test('parses no command or params from a line with no letters at all', () => {
    const cmd = parse('{5}');
    expect(cmd.gcode).toEqual('');
    expect(cmd.params).toEqual({});
  });

  test('drops valueless letters in free text instead of storing NaN params', () => {
    // M117 style messages have no value after each letter, so each parses to NaN.
    // Those are no longer stored: params only ever hold finite numbers now.
    const cmd = parse('M117 Hi');
    expect(cmd.gcode).toEqual('m117');
    expect(cmd.params).toEqual({});
  });
});

test('parseGCode accepts an array of lines', () => {
  const parser = new Parser();
  const parsed = parser.parseGCode(['G1 X1 Y1', 'G1 X2']);
  expect(parsed.commands.length).toEqual(2);
  expect(parsed.commands[0].params.x).toEqual(1);
  expect(parsed.commands[1].params.x).toEqual(2);
});

test('parseMetadata skips commands without a comment', () => {
  const parser = new Parser();
  const commands = [
    new GCodeCommand('G1 X1', 'g1', { x: 1 }), // comment undefined
    new GCodeCommand('G1 X2 ;', 'g1', { x: 2 }, ''), // comment empty string
    new GCodeCommand('G1 X3 ; hello', 'g1', { x: 3 }, ' hello') // non-thumbnail comment
  ];
  const metadata = parser.parseMetadata(commands);
  expect(metadata.thumbnails).toEqual({});
});

test('parseGCode extracts a valid thumbnail from comments', () => {
  const parser = new Parser();
  const chars = 'ABCD'.repeat(25); // 100 valid base64 chars
  const gcode = [`; thumbnail begin 16x16 ${chars.length}`, `; ${chars}`, '; thumbnail end'].join('\n');
  const parsed = parser.parseGCode(gcode);
  expect(parsed.metadata.thumbnails['16x16']).toBeDefined();
  expect(parsed.metadata.thumbnails['16x16'].chars).toEqual(chars);
});

test('parseGCode ignores a thumbnail with invalid data', () => {
  const parser = new Parser();
  const gcode = ['; thumbnail begin 8x8 100', '; tooshort', '; thumbnail end'].join('\n');
  const parsed = parser.parseGCode(gcode);
  expect(parsed.metadata.thumbnails['8x8']).toBeUndefined();
});

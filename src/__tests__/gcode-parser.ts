import { test, expect } from 'vitest';
import { GCodeCommand, Parser } from '../gcode-parser';

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

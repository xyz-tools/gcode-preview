import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, describe } from 'vitest';

import { Parser } from '../parser/gcode-parser';
import { Thumbnail } from '../thumbnail';

const gcodeCommentsWithThumbnail = `
; thumbnail begin 16x16 856
; iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACSElEQVR4AXVSW08TURDuHyHSG9vunS
; 21LaX0okiRQq1tipegwSAQQdNoG1ZBGogBJUo0GIiisIlN2sSEB+KDJvgiMSY+uIn8kf0Hw5mT7LIt
; 9GHOmTnnzPfNd2YcHMcN8DyfFgQhw7Js0vTNOBeVyh9uBY/zMVk9796BDoLgbl6aoPPDinY4E4I/j6
; LUno4EasW4olZzIbrjG0c75umUoO3fVeBgImABoP0txUBNuaBxJwAUABdRFK+ZibgvjAbr+Hhl0AvV
; K94mgO08D3s3JNifCEKvyJQc9pLNKiaTvHZwrwfWrjKwdZ2niUezEdgY9cNUuAP+z6fgXzkOfbJfPR
; egX/aV1KQLdsdEi3V5sAumSfJyuosCfJ+JnEqwa8c4obBqOeGEJ3EnrJIqkHU9w8Dzyx4LYDUr6VYX
; 0LG3c6cowlaOgx/3L8Lj/k542HcB3mVZqBDQT2MS6JUkRCVf2eqCvX0beeUYmV5nfLA2xFgALwgzAj
; TGFVgk9+Z7hzkDaOs5Wd8tCvCesO8R/egjAAJ+uSmRf/DCIdGe7vbUmgYJHdT0mSSgLZGESsprfCzw
; UB3wUIBvkyHj51zMeDbSUzP/CttPP3ElI+jI+OtBGN5keePVMEOrmAp1wMsMZ7wl+jdJnJbdmr1bVA
; IG+Pj3XC/Ub8uUaYcwL1xyw9fxbnIeAQRIie4m5iYJYdG/uF0QaRJWgXY0GyZDxMGQ4qm1TuoZADwI
; 8oxaCHTqDcK6mWNhiWhP8E6tNaEtgHkQF1z1hOCut0tojU8AXkBuxgoBg+8AAAAASUVORK5CYII=
; thumbnail end`;

const encodedImg = `iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACSElEQVR4AXVSW08TURDuHyHSG9vunS21LaX0okiRQq1tipegwSAQQdNoG1ZBGogBJUo0GIiisIlN2sSEB+KDJvgiMSY+uIn8kf0Hw5mT7LIt9GHOmTnnzPfNd2YcHMcN8DyfFgQhw7Js0vTNOBeVyh9uBY/zMVk9796BDoLgbl6aoPPDinY4E4I/j6LUno4EasW4olZzIbrjG0c75umUoO3fVeBgImABoP0txUBNuaBxJwAUABdRFK+ZibgvjAbr+Hhl0AvVK94mgO08D3s3JNifCEKvyJQc9pLNKiaTvHZwrwfWrjKwdZ2niUezEdgY9cNUuAP+z6fgXzkOfbJfPRegX/aV1KQLdsdEi3V5sAumSfJyuosCfJ+JnEqwa8c4obBqOeGEJ3EnrJIqkHU9w8Dzyx4LYDUr6VYX0LG3c6cowlaOgx/3L8Lj/k542HcB3mVZqBDQT2MS6JUkRCVf2eqCvX0beeUYmV5nfLA2xFgALwgzAjTGFVgk9+Z7hzkDaOs5Wd8tCvCesO8R/egjAAJ+uSmRf/DCIdGe7vbUmgYJHdT0mSSgLZGESsprfCzwUB3wUIBvkyHj51zMeDbSUzP/CttPP3ElI+jI+OtBGN5keePVMEOrmAp1wMsMZ7wl+jdJnJbdmr1bVAIG+Pj3XC/Ub8uUaYcwL1xyw9fxbnIeAQRIie4m5iYJYdG/uF0QaRJWgXY0GyZDxMGQ4qm1TuoZADwI8oxaCHTqDcK6mWNhiWhP8E6tNaEtgHkQF1z1hOCut0tojU8AXkBuxgoBg+8AAAAASUVORK5CYII=`;

test('correct base64 image should be valid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg;
  thumb.charLength = encodedImg.length;
  expect(thumb.isValid).toBeTruthy();
});

test('incorrect base64 image should be invalid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg.slice(0, -1);
  thumb.charLength = encodedImg.length;
  expect(thumb.isValid).toBeFalsy();
});

test('not matching size should be invalid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg;
  thumb.charLength = encodedImg.length + 1;
  expect(thumb.isValid).toBeFalsy();
});

test('src should be a jpeg data URL of the base64 chars', () => {
  const thumb = new Thumbnail('16x16', 16, 16, encodedImg.length);
  thumb.chars = encodedImg;
  expect(thumb.src).toEqual('data:image/jpeg;base64,' + encodedImg);
});

test('well-formatted thumbnail should be parsed', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode(gcodeCommentsWithThumbnail);

  expect(parsed).not.toBeNull();
  expect(parsed.metadata).not.toBeNull();
  expect(parsed.metadata.thumbnails).not.toBeNull();
  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(1);
});

test('no thumbnail should be parsed if none present', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode('; no thumbnail');

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('thumbnail with incorrect size should be ignored', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode(gcodeCommentsWithThumbnail.replace('856', '857'));

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('no thumbnail should be parsed if "end thumbnail" is missing', () => {
  const parser = new Parser(0);
  const parts = gcodeCommentsWithThumbnail.split(';');
  parts.pop();
  const parsed = parser.parseGCode(parts.join(';'));

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('only 1 thumbnail should be parsed if "end thumbnail" is missing for the first but not the second', () => {
  const parser = new Parser(0);
  const parts = gcodeCommentsWithThumbnail.split(';');
  parts.pop();
  const parts2 = gcodeCommentsWithThumbnail.split(';');
  parts.push(...parts2);
  const parsed = parser.parseGCode(parts.join(';'));

  expect(parsed).not.toBeNull();
  expect(parsed.metadata.thumbnails).not.toBeNull();
  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(1);
  const secondThumb = Object.values(parsed.metadata.thumbnails)[0] as Thumbnail;
  expect(secondThumb.charLength).toEqual(secondThumb.chars.length);
});

test('thumbnail split mid-base64 across parseGCode calls should be parsed', () => {
  // Streaming feeds each chunk to parseGCode separately, so the in-progress
  // thumbnail must survive between calls on the same Parser instance.
  const parser = new Parser(0);
  const lines = gcodeCommentsWithThumbnail.trim().split('\n');

  parser.parseGCode(lines.slice(0, 5).join('\n')); // begin + first data lines
  parser.parseGCode(lines.slice(5, 9).join('\n')); // more base64, no markers
  parser.parseGCode(lines.slice(9).join('\n')); // rest of the data + end

  expect(Object.keys(parser.metadata.thumbnails).length).toEqual(1);
  const thumb = Object.values(parser.metadata.thumbnails)[0] as Thumbnail;
  expect(thumb.chars).toEqual(encodedImg);
  expect(thumb.isValid).toBeTruthy();
});

test('thumbnail split between "thumbnail begin" and the data should be parsed', () => {
  const parser = new Parser(0);
  const lines = gcodeCommentsWithThumbnail.trim().split('\n');

  parser.parseGCode(lines[0]); // only '; thumbnail begin 16x16 856'
  parser.parseGCode(lines.slice(1).join('\n')); // all data lines + end

  expect(Object.keys(parser.metadata.thumbnails).length).toEqual(1);
  const thumb = Object.values(parser.metadata.thumbnails)[0] as Thumbnail;
  expect(thumb.isValid).toBeTruthy();
});

test('skip thumb if not base64', () => {
  const parser = new Parser(0);
  const gcodeWithIllegalBase64 =
    `
  ; thumbnail begin 16x16 123
  ; ` +
    encodedImg.slice(0, -1) +
    `
  ; thumbnail end`;
  const parsed = parser.parseGCode(gcodeWithIllegalBase64);

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

describe('Quint spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/thumbnail.qnt against
  // the real Parser's thumbnail machine. Each trace state carries the event
  // that produced it (cmd/evWidth/evHeight/evCount/evN) and the spec's
  // resulting machine state; the replay rebuilds each event as the comment
  // line the parser would see and compares after every line.
  //
  // Filler convention (shared with the spec): data lines are evN copies of a
  // base64-alphabet character, garbage lines are the fixed 9-char non-base64
  // comment '*garbage*', so the real base64 regex passes iff the spec's
  // clean && collected % 4 == 0 condition holds.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'thumbnail');

  // An ITF value: booleans and strings are plain JSON; integers arrive either
  // as plain numbers or in Apalache's { "#bigint": "123" } wrapping; maps and
  // tuples arrive as { "#map": [[k, v], ...] } and { "#tup": [...] }.
  type ItfValue =
    | boolean
    | string
    | number
    | { '#bigint': string }
    | { '#map': [ItfValue, ItfValue][] }
    | { '#tup': ItfValue[] }
    | undefined;
  type ItfState = Record<string, ItfValue>;

  const itfInt = (value: ItfValue, key: string): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && '#bigint' in value && typeof value['#bigint'] === 'string') {
      return Number(value['#bigint']);
    }
    throw new Error(`expected an ITF integer for "${key}", got ${JSON.stringify(value)}`);
  };
  const itfBool = (value: ItfValue, key: string): boolean => {
    if (typeof value !== 'boolean') throw new Error(`expected a boolean for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };
  const itfStr = (value: ItfValue, key: string): string => {
    if (typeof value !== 'string') throw new Error(`expected a string for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };

  // The spec's stored map: (width, height) -> char length, as a list of entries.
  type StoredEntry = { width: number; height: number; length: number };
  const itfStored = (value: ItfValue, key: string): StoredEntry[] => {
    if (typeof value !== 'object' || value === null || !('#map' in value) || !Array.isArray(value['#map'])) {
      throw new Error(`expected an ITF map for "${key}", got ${JSON.stringify(value)}`);
    }
    return value['#map'].map(([k, v]) => {
      if (
        typeof k !== 'object' ||
        k === null ||
        !('#tup' in k) ||
        !Array.isArray(k['#tup']) ||
        k['#tup'].length !== 2
      ) {
        throw new Error(`expected an ITF pair key for "${key}", got ${JSON.stringify(k)}`);
      }
      return {
        width: itfInt(k['#tup'][0], `${key} key width`),
        height: itfInt(k['#tup'][1], `${key} key height`),
        length: itfInt(v, `${key} value`)
      };
    });
  };

  // The spec's state variables, decoded; keys starting with '#' (like '#meta')
  // are never read and are thereby ignored.
  type SpecState = {
    cmd: string;
    evWidth: number;
    evHeight: number;
    evCount: number;
    evN: number;
    phase: string;
    width: number;
    height: number;
    expected: number;
    collected: number;
    clean: boolean;
    stored: StoredEntry[];
  };

  const decodeState = (raw: ItfState): SpecState => ({
    cmd: itfStr(raw.cmd, 'cmd'),
    evWidth: itfInt(raw.evWidth, 'evWidth'),
    evHeight: itfInt(raw.evHeight, 'evHeight'),
    evCount: itfInt(raw.evCount, 'evCount'),
    evN: itfInt(raw.evN, 'evN'),
    phase: itfStr(raw.phase, 'phase'),
    width: itfInt(raw.width, 'width'),
    height: itfInt(raw.height, 'height'),
    expected: itfInt(raw.expected, 'expected'),
    collected: itfInt(raw.collected, 'collected'),
    clean: itfBool(raw.clean, 'clean'),
    stored: itfStored(raw.stored, 'stored')
  });

  // Builds the input line a spec state's event describes. Data payloads use a
  // fixed base64-alphabet filler so the char count is exact; the garbage text
  // is 9 chars of non-base64 comment (the spec's GarbageLen).
  const buildLine = (spec: SpecState): string => {
    switch (spec.cmd) {
      case 'begin':
        return `; thumbnail begin ${spec.evWidth}x${spec.evHeight} ${spec.evCount}`;
      case 'data':
        return `; ${'A'.repeat(spec.evN)}`;
      case 'end':
        return '; thumbnail end';
      case 'garbage':
        return '; *garbage*';
      case 'neutral':
        return 'G1 X1';
      default:
        throw new Error(`unknown event "${spec.cmd}"`);
    }
  };

  // The in-progress thumbnail lives in a private field; the replay reads it to
  // observe the machine's phase and accumulation between begin and end.
  const inProgress = (parser: Parser): Thumbnail | undefined => (parser as unknown as { thumb?: Thumbnail }).thumb;

  // The full per-step comparison from the trace contract. Every assertion
  // message names the trace file, step index, input line, field, and the
  // expected vs actual values.
  const compareStep = (traceFile: string, stepIndex: number, line: string, parser: Parser, spec: SpecState): void => {
    const at = (field: string, expected: unknown, actual: unknown) =>
      `${traceFile} step ${stepIndex} (${line}) field ${field}: expected ${String(expected)}, actual ${String(actual)}`;

    const thumb = inProgress(parser);
    if (spec.phase === 'collecting') {
      expect(thumb, at('phase', 'collecting (in-progress thumbnail)', 'none')).toBeDefined();
      const t = thumb as Thumbnail;
      const sizeKey = `${spec.width}x${spec.height}`;
      expect(t.size, at('size', sizeKey, t.size)).toBe(sizeKey);
      expect(t.width, at('width', spec.width, t.width)).toBe(spec.width);
      expect(t.height, at('height', spec.height, t.height)).toBe(spec.height);
      expect(t.charLength, at('charLength', spec.expected, t.charLength)).toBe(spec.expected);
      expect(t.chars.length, at('chars.length', spec.collected, t.chars.length)).toBe(spec.collected);
    } else {
      expect(thumb, at('phase', 'idle (no in-progress thumbnail)', 'present')).toBeUndefined();
    }

    const actualKeys = Object.keys(parser.metadata.thumbnails).sort();
    const specKeys = spec.stored.map((entry) => `${entry.width}x${entry.height}`).sort();
    expect(actualKeys, at('stored keys', specKeys.join(',') || '<none>', actualKeys.join(',') || '<none>')).toEqual(
      specKeys
    );
    for (const entry of spec.stored) {
      const key = `${entry.width}x${entry.height}`;
      const storedThumb = parser.metadata.thumbnails[key];
      expect(storedThumb, at(`stored[${key}]`, 'a thumbnail', storedThumb)).toBeDefined();
      expect(storedThumb.width, at(`stored[${key}].width`, entry.width, storedThumb.width)).toBe(entry.width);
      expect(storedThumb.height, at(`stored[${key}].height`, entry.height, storedThumb.height)).toBe(entry.height);
      expect(storedThumb.charLength, at(`stored[${key}].charLength`, entry.length, storedThumb.charLength)).toBe(
        entry.length
      );
      expect(storedThumb.chars.length, at(`stored[${key}].chars.length`, entry.length, storedThumb.chars.length)).toBe(
        entry.length
      );
      expect(storedThumb.isValid, at(`stored[${key}].isValid`, true, storedThumb.isValid)).toBe(true);
    }
  };

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
    test(`replays ${traceFile} through the parser's thumbnail machine`, () => {
      const parsed = JSON.parse(readFileSync(join(tracesDir, traceFile), 'utf8')) as { states: ItfState[] };
      expect(Array.isArray(parsed.states), `${traceFile}: ITF file has no states array`).toBe(true);
      expect(parsed.states.length, `${traceFile}: trace has no states`).toBeGreaterThan(0);
      const states = parsed.states.map(decodeState);

      // One parser per trace: the in-progress thumbnail and the completed
      // record persist across the steps.
      const parser = new Parser();

      expect(states[0].cmd, `${traceFile} step 0: the first state must be the init state`).toBe('init');
      compareStep(traceFile, 0, '<init>', parser, states[0]);

      for (let step = 1; step < states.length; step++) {
        const spec = states[step];
        if (spec.cmd === 'stutter') {
          // A stutter step records no input: the machine state must carry over.
          compareStep(traceFile, step, '<stutter>', parser, spec);
          continue;
        }
        const line = buildLine(spec);
        parser.parseGCode(line);
        compareStep(traceFile, step, line, parser, spec);
      }
    });
  }
});

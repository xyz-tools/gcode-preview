import { join } from 'node:path';
import { test, expect, describe } from 'vitest';

import { Parser } from '../parser/gcode-parser';
import { Thumbnail } from '../thumbnail';
import { listTraceFiles, readTrace, itfInt, itfStr, itfList, itfRecord, type ItfValue } from './helpers/itf-replay';

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

describe('thumbnail spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/thumbnail.qnt
  // against the real Parser's thumbnail machine. Each trace state holds two
  // records: `s` (the machine state: in-progress block, stored record, ghost
  // counters) and `ev` (the comment line this step fed, as counts and header
  // numbers). The replay rebuilds each line with concrete characters drawn
  // from the full base64 alphabet — '+', '/', digits and '=' pad runs
  // included — feeds it to one Parser per trace, and compares the observable
  // thumbnail state after every line, chars content included. All numbers
  // are character counts or pixel dimensions, compared exactly with toBe
  // (Object.is, so the coerced-NaN header fields compare exactly too).
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'thumbnail');

  // The spec's SizeBad token: a size with no parsable dimensions. Keep in
  // sync with thumbnail.qnt's HBadDims annotation and thumbnail.md.
  const BAD_SIZE_TOKEN = 'qq';

  // Data payloads cycle through the whole base64 alphabet, so every
  // character class the validity regex accepts appears in the corpus
  // (v1 fed a single filler character); '=' is appended separately as the
  // trailing pad run the event declares.
  const PALETTE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // Non-base64 comment lines by trimmed length; every entry contains at
  // least one character outside [A-Za-z0-9+/=] and no ';'. Keep in sync
  // with GARBAGE_LENS in thumbnail.qnt.
  const GARBAGE_LINES: Record<number, string> = { 3: '#@!', 5: 'no!64', 9: '*garbage*' };

  /** A Quint sum-type value in ITF form: { tag, value }. */
  const itfVariant = (value: ItfValue | undefined, key: string): { tag: string; value: ItfValue | undefined } => {
    const record = itfRecord(value, key);
    return { tag: itfStr(record.tag, `${key}.tag`), value: record.value };
  };

  /** The spec's SizeKey, decoded to the implementation's size string plus
   * the width/height the implementation coerces out of that token. */
  type KeyInfo = { key: string; width: number; height: number };
  const decodeKey = (value: ItfValue | undefined, at: string): KeyInfo => {
    const { tag, value: payload } = itfVariant(value, at);
    switch (tag) {
      case 'SizeWH': {
        const record = itfRecord(payload, at);
        const w = itfInt(record.w, `${at}.w`);
        const h = itfInt(record.h, `${at}.h`);
        return { key: `${w}x${h}`, width: w, height: h };
      }
      case 'SizeBad':
        // 'qq' has no 'x'-split dimensions: both coerce to NaN.
        return { key: BAD_SIZE_TOKEN, width: NaN, height: NaN };
      case 'SizeEmpty':
        // ''.split('x') yields [''], so the width coerces to 0 and the
        // missing height to NaN.
        return { key: '', width: 0, height: NaN };
      default:
        throw new Error(`unknown SizeKey variant "${tag}" at ${at}`);
    }
  };

  /** The spec's Decl, decoded to the implementation's charLength (NaN for
   * a header that declared no count). */
  const decodeDecl = (value: ItfValue | undefined, at: string): number => {
    const { tag, value: payload } = itfVariant(value, at);
    if (tag === 'Declared') return itfInt(payload, at);
    if (tag === 'NoDecl') return NaN;
    throw new Error(`unknown Decl variant "${tag}" at ${at}`);
  };

  type SpecProgress = { collecting: false } | { collecting: true; key: KeyInfo; charLength: number; collected: number };
  type SpecStored = { key: KeyInfo; len: number };
  type SpecStep = {
    kind: string;
    header: string;
    w: number;
    h: number;
    cnt: number;
    alphas: number;
    pads: number;
    gLen: number;
    progress: SpecProgress;
    stored: SpecStored[];
    // ghostStores is the one ghost the replay decodes: it pins the exact
    // step a block is stored, which the stored record alone cannot show
    // when a same-key same-length block replaces an earlier one.
    stores: number;
  };

  const decodeStep = (raw: Record<string, ItfValue>): SpecStep => {
    const s = itfRecord(raw.s, 's');
    const ev = itfRecord(raw.ev, 'ev');
    const progressVariant = itfVariant(s.progress, 's.progress');
    let progress: SpecProgress;
    if (progressVariant.tag === 'Idle') {
      progress = { collecting: false };
    } else if (progressVariant.tag === 'Collecting') {
      const block = itfRecord(progressVariant.value, 's.progress.value');
      progress = {
        collecting: true,
        key: decodeKey(block.key, 's.progress.value.key'),
        charLength: decodeDecl(block.decl, 's.progress.value.decl'),
        collected: itfInt(block.collected, 's.progress.value.collected')
      };
    } else {
      throw new Error(`unknown Progress variant "${progressVariant.tag}"`);
    }
    return {
      kind: itfStr(ev.kind, 'ev.kind'),
      header: itfStr(ev.header, 'ev.header'),
      w: itfInt(ev.w, 'ev.w'),
      h: itfInt(ev.h, 'ev.h'),
      cnt: itfInt(ev.cnt, 'ev.cnt'),
      alphas: itfInt(ev.alphas, 'ev.alphas'),
      pads: itfInt(ev.pads, 'ev.pads'),
      gLen: itfInt(ev.gLen, 'ev.gLen'),
      progress,
      stored: itfList(s.stored, 's.stored').map((entry, i) => {
        const record = itfRecord(entry, `s.stored[${i}]`);
        return {
          key: decodeKey(record.key, `s.stored[${i}].key`),
          len: itfInt(record.len, `s.stored[${i}].len`)
        };
      }),
      stores: itfInt(s.ghostStores, 's.ghostStores')
    };
  };

  // The in-progress thumbnail lives in a private field; the replay reads it
  // to observe the machine's phase and accumulation between begin and end.
  // OPEN item (see thumbnail.md): mid-flight phases have no public
  // observable, so the peek stays.
  const inProgress = (parser: Parser): Thumbnail | undefined => (parser as unknown as { thumb?: Thumbnail }).thumb;

  const traceFiles = listTraceFiles(tracesDir);

  test('the v2 traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces/thumbnail.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    test(`replays ${traceFile} through the parser's thumbnail machine`, () => {
      const states = readTrace(tracesDir, traceFile).map(decodeStep);
      expect(states[0].kind, `${traceFile} step 0: the first state must be the init state`).toBe('init');

      // One parser per trace: the in-progress thumbnail and the completed
      // record persist across the steps.
      const parser = new Parser();
      // Rolling cursor through PALETTE, so consecutive payload lines carry
      // different character mixes (deterministic per trace).
      let paletteCursor = 0;
      const payloadChars = (count: number): string => {
        let out = '';
        for (let i = 0; i < count; i++) out += PALETTE[paletteCursor++ % PALETTE.length];
        return out;
      };
      // The exact characters fed into the current block / stored per size
      // key, so chars CONTENT is compared, not just its length.
      let acc = '';
      const expectedChars = new Map<string, string>();
      let prevStores = 0;

      const compareStep = (stepIndex: number, line: string, spec: SpecStep): void => {
        const at = (field: string, expected: unknown, actual: unknown): string =>
          `${traceFile} step ${stepIndex} (${line}) field ${field}: expected ${String(expected)}, actual ${String(actual)}`;

        const thumb = inProgress(parser);
        if (spec.progress.collecting) {
          expect(thumb, at('phase', 'collecting (in-progress thumbnail)', 'none')).toBeDefined();
          const t = thumb as Thumbnail;
          expect(t.size, at('size', spec.progress.key.key, t.size)).toBe(spec.progress.key.key);
          expect(t.width, at('width', spec.progress.key.width, t.width)).toBe(spec.progress.key.width);
          expect(t.height, at('height', spec.progress.key.height, t.height)).toBe(spec.progress.key.height);
          expect(t.charLength, at('charLength', spec.progress.charLength, t.charLength)).toBe(spec.progress.charLength);
          expect(t.chars.length, at('chars.length', spec.progress.collected, t.chars.length)).toBe(
            spec.progress.collected
          );
          expect(t.chars, at('chars', acc, t.chars)).toBe(acc);
        } else {
          expect(thumb, at('phase', 'idle (no in-progress thumbnail)', 'present')).toBeUndefined();
        }

        const actualKeys = Object.keys(parser.metadata.thumbnails).sort();
        const specKeys = spec.stored.map((entry) => entry.key.key).sort();
        expect(actualKeys, at('stored keys', specKeys.join(',') || '<none>', actualKeys.join(',') || '<none>')).toEqual(
          specKeys
        );
        for (const entry of spec.stored) {
          const stored = parser.metadata.thumbnails[entry.key.key];
          expect(stored, at(`stored[${entry.key.key}]`, 'a thumbnail', stored)).toBeDefined();
          expect(stored.width, at(`stored[${entry.key.key}].width`, entry.key.width, stored.width)).toBe(
            entry.key.width
          );
          expect(stored.height, at(`stored[${entry.key.key}].height`, entry.key.height, stored.height)).toBe(
            entry.key.height
          );
          expect(stored.charLength, at(`stored[${entry.key.key}].charLength`, entry.len, stored.charLength)).toBe(
            entry.len
          );
          expect(stored.chars.length, at(`stored[${entry.key.key}].chars.length`, entry.len, stored.chars.length)).toBe(
            entry.len
          );
          expect(stored.isValid, at(`stored[${entry.key.key}].isValid`, true, stored.isValid)).toBe(true);
          const expected = expectedChars.get(entry.key.key);
          expect(expected, at(`stored[${entry.key.key}].chars`, 'a recorded payload', expected)).toBeDefined();
          expect(stored.chars, at(`stored[${entry.key.key}].chars`, expected, stored.chars)).toBe(expected);
        }
      };

      compareStep(0, '<init>', states[0]);

      for (let step = 1; step < states.length; step++) {
        const spec = states[step];
        const wasCollecting = states[step - 1].progress.collecting;

        let line: string;
        let payload = '';
        switch (spec.kind) {
          case 'begin':
            switch (spec.header) {
              case 'full':
                line = `; thumbnail begin ${spec.w}x${spec.h} ${spec.cnt}`;
                break;
              case 'nocount':
                line = `; thumbnail begin ${spec.w}x${spec.h}`;
                break;
              case 'baddims':
                line = `; thumbnail begin ${BAD_SIZE_TOKEN} ${spec.cnt}`;
                break;
              case 'empty':
                line = '; thumbnail begin';
                break;
              default:
                throw new Error(`unknown begin header "${spec.header}"`);
            }
            acc = '';
            break;
          case 'data':
            payload = payloadChars(spec.alphas) + '='.repeat(spec.pads);
            line = `; ${payload}`;
            break;
          case 'garbage': {
            const garbage = GARBAGE_LINES[spec.gLen];
            if (garbage === undefined || garbage.length !== spec.gLen) {
              throw new Error(`no garbage line of length ${spec.gLen}; update GARBAGE_LINES`);
            }
            payload = garbage;
            line = `; ${garbage}`;
            break;
          }
          case 'end':
            line = '; thumbnail end';
            break;
          case 'neutral':
            line = 'G1 X1';
            break;
          default:
            throw new Error(`unknown event "${spec.kind}"`);
        }

        parser.parseGCode(line);

        // Mirror the collector's accumulation: marker-free comments append
        // their trimmed text only while a block is open.
        if ((spec.kind === 'data' || spec.kind === 'garbage') && wasCollecting) acc += payload;
        // A store happened exactly when the spec's store counter ticked; the
        // key is the block that was open before this end line.
        if (spec.kind === 'end' && spec.stores > prevStores) {
          const prev = states[step - 1].progress;
          if (!prev.collecting) throw new Error(`${traceFile} step ${step}: store without an open block`);
          expectedChars.set(prev.key.key, acc);
        }
        prevStores = spec.stores;

        compareStep(step, line, spec);
      }
    });
  }
});

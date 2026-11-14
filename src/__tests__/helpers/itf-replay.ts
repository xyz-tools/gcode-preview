import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared utilities for replaying Quint ITF traces against the real
 * implementation. Suites keep their domain logic (decoding their spec's
 * state record, building inputs, comparing observables); this module owns
 * the generic ITF plumbing so it exists once instead of per suite.
 */

/** An ITF value: booleans/strings are plain JSON; integers arrive as plain
 * numbers or in Apalache's `{ "#bigint": "123" }` wrapping; records are
 * objects, lists are arrays. */
export type ItfValue = boolean | string | number | { '#bigint': string } | ItfValue[] | { [key: string]: ItfValue };
export type ItfState = Record<string, ItfValue>;

export const itfInt = (value: ItfValue | undefined, key: string): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`unsafe ITF integer for "${key}": ${value}`);
    return value;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const wrapped = (value as { '#bigint'?: ItfValue })['#bigint'];
    if (typeof wrapped === 'string') {
      const n = Number(wrapped);
      if (!Number.isSafeInteger(n)) throw new Error(`unsafe ITF integer for "${key}": ${wrapped}`);
      return n;
    }
  }
  throw new Error(`expected an ITF integer for "${key}", got ${JSON.stringify(value)}`);
};

export const itfBool = (value: ItfValue | undefined, key: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`expected a boolean for "${key}", got ${JSON.stringify(value)}`);
  return value;
};

export const itfStr = (value: ItfValue | undefined, key: string): string => {
  if (typeof value !== 'string') throw new Error(`expected a string for "${key}", got ${JSON.stringify(value)}`);
  return value;
};

export const itfList = (value: ItfValue | undefined, key: string): ItfValue[] => {
  if (!Array.isArray(value)) throw new Error(`expected an ITF list for "${key}", got ${JSON.stringify(value)}`);
  return value;
};

export const itfRecord = (value: ItfValue | undefined, key: string): ItfState => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || '#bigint' in value) {
    throw new Error(`expected an ITF record for "${key}", got ${JSON.stringify(value)}`);
  }
  return value as ItfState;
};

/** Loads every `*.itf.json` trace in a directory, sorted by file name.
 * Returns the file names; a suite should fail (not skip) when empty. */
export const listTraceFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.itf.json'))
      .sort();
  } catch {
    return [];
  }
};

export const readTrace = (dir: string, file: string): ItfState[] => {
  const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { states?: ItfState[] };
  if (!Array.isArray(parsed.states) || parsed.states.length === 0) {
    throw new Error(`${file}: ITF file has no states`);
  }
  return parsed.states;
};

/**
 * Exact comparison between a real millimeter value and a spec value in
 * centi-millimeters. The specs model lengths as integers (mm * 100), so the
 * implementation value scaled by 100 must round to EXACTLY the spec integer,
 * and the rounding slack must be float noise (sub-1e-9), not a semantic gap.
 * Returns an error string, or null when equal.
 */
export const centiMismatch = (actualMm: number, expectedCenti: number): string | null => {
  const scaled = actualMm * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-9) {
    return `value ${actualMm} is not a centi-integer (scaled ${scaled})`;
  }
  if (rounded !== expectedCenti) {
    return `expected ${expectedCenti / 100}, actual ${actualMm}`;
  }
  return null;
};

import { readFileSync } from 'fs';
import { test, expect } from 'vitest';

import pkg from '../../package.json';

const MIN_VERSION = '0.166.0';
const MAX_EXCLUSIVE_VERSION = '0.186.0';
const SUPPORTED_RANGE = `>=${MIN_VERSION} <${MAX_EXCLUSIVE_VERSION}`;

function parseVersion(version: string): number {
  const match = version.match(/^0\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`unexpected three.js version: ${version}`);
  }
  return Number(match[1]);
}

const minMinor = Number(MIN_VERSION.split('.')[1]);
const maxMinorExclusive = Number(MAX_EXCLUSIVE_VERSION.split('.')[1]);

test('three.js dependency is declared as the supported range', () => {
  expect(pkg.dependencies.three).toBe(SUPPORTED_RANGE);
});

test('installed three.js version is within the supported range', () => {
  const threePkg = JSON.parse(readFileSync(`${process.cwd()}/node_modules/three/package.json`, 'utf8'));
  const version = parseVersion(threePkg.version);
  expect(version).toBeGreaterThanOrEqual(minMinor);
  expect(version).toBeLessThan(maxMinorExclusive);
});

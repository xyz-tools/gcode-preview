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

test('three.js is declared as a peer dependency with the supported range', () => {
  expect(pkg.peerDependencies.three).toBe(SUPPORTED_RANGE);
});

test('three.js is not also a regular dependency', () => {
  // shipping three as a regular dependency lets a consumer end up with a
  // second copy of it, and two copies are two different sets of classes:
  // instanceof fails across the boundary and helpers like STLExporter reject
  // objects built by the other copy
  expect((pkg.dependencies as Record<string, string>).three).toBeUndefined();
});

test('rollup treats every peer dependency as external', async () => {
  // the bundle must import three rather than inline it -- otherwise moving it
  // to peerDependencies achieves nothing, because every consumer still gets
  // the library's own copy baked into the dist
  const { default: config } = await import('../../rollup.config.mjs');
  const external = (config as { external?: string[] }[])[0].external ?? [];

  for (const name of Object.keys(pkg.peerDependencies)) {
    expect(external).toContain(name);
  }
});

test('installed three.js version is within the supported range', () => {
  const threePkg = JSON.parse(readFileSync(`${process.cwd()}/node_modules/three/package.json`, 'utf8'));
  const version = parseVersion(threePkg.version);
  expect(version).toBeGreaterThanOrEqual(minMinor);
  expect(version).toBeLessThan(maxMinorExclusive);
});

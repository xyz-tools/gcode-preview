// Runs every Quint spec under verification/quint/: the semantic test runs
// (quint test) and a seeded random simulation of the spec's `allInvariants`
// value (quint run). House conventions for every spec file: define `init`,
// `step`, `allInvariants`, and name the semantic runs `*Test`.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const QUINT_DIR = 'verification/quint';
export const SEED = '0x67c0de2026';

export const specs = () =>
  readdirSync(QUINT_DIR)
    .filter((file) => file.endsWith('.qnt'))
    .sort()
    .map((file) => ({ name: file.replace(/\.qnt$/, ''), path: join(QUINT_DIR, file) }));

export const quint = (args) => {
  const result = spawnSync('npx', ['quint', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Import guard so quint-traces.mjs can reuse the helpers above without
// triggering the checks.
if (process.argv[1].endsWith('quint-check.mjs')) {
  for (const spec of specs()) {
    console.log(`\n=== ${spec.name} ===`);
    quint(['test', spec.path]);
    quint([
      'run',
      spec.path,
      '--invariant',
      'allInvariants',
      '--max-samples',
      '200',
      '--max-steps',
      '30',
      '--seed',
      SEED,
      '--verbosity',
      '1'
    ]);
  }
}

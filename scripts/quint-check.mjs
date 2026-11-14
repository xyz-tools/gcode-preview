// Checks every Quint spec in the manifest, three gates per spec:
// 1. `quint test` — the semantic *Test runs.
// 2. Invariant simulation — a pinned-seed lane (reproducible baseline) plus a
//    fresh-seed lane (CI accumulates exploration over time; the seed is
//    printed so any failure is reproducible with --seed).
// 3. Trace freshness — regenerates the committed ITF traces into a temp dir
//    and compares the state sequences, so a spec edit cannot land with stale
//    committed traces.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_SEED, SPECS, quint, traceGenArgs } from './quint-specs.mjs';

const freshSeed = `0x${Date.now().toString(16)}`;
let failed = false;

const statesOf = (dir, file) => JSON.stringify(JSON.parse(readFileSync(join(dir, file), 'utf8')).states);

for (const spec of SPECS) {
  console.log(`\n=== ${spec.name} ===`);

  quint(['test', spec.path, ...(spec.testMain ? ['--main', spec.testMain] : [])]);

  if (spec.invariant) {
    const simulate = (seed) =>
      quint([
        'run',
        spec.path,
        ...(spec.main ? ['--main', spec.main] : []),
        '--invariant',
        spec.invariant,
        '--max-samples',
        '200',
        '--max-steps',
        '30',
        `--seed=${seed}`,
        '--verbosity',
        '1'
      ]);
    simulate(BASE_SEED);
    console.log(`fresh-seed lane: ${freshSeed}`);
    simulate(freshSeed);
  }

  if (spec.traces) {
    const temp = mkdtempSync(join(tmpdir(), 'quint-fresh-'));
    try {
      for (const args of traceGenArgs(spec, temp)) quint(args);
      const committed = readdirSync(spec.traces.dir)
        .filter((f) => f.endsWith('.itf.json'))
        .sort();
      const regenerated = readdirSync(temp)
        .filter((f) => f.endsWith('.itf.json'))
        .sort();
      if (committed.join() !== regenerated.join()) {
        console.error(
          `STALE TRACES for ${spec.name}: file sets differ (committed ${committed.length}, regenerated ${regenerated.length}). Run: npm run quint:traces`
        );
        failed = true;
      } else {
        const stale = committed.filter((f) => statesOf(spec.traces.dir, f) !== statesOf(temp, f));
        if (stale.length > 0) {
          console.error(
            `STALE TRACES for ${spec.name}: ${stale.join(', ')} differ from the current spec. Run: npm run quint:traces`
          );
          failed = true;
        } else {
          console.log(`traces fresh (${committed.length} files)`);
        }
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

if (failed) process.exit(1);

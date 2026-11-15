// Manifest of every Quint spec the runners drive, plus shared helpers.
// Entry points: quint-check.mjs (tests + invariant simulation + trace
// freshness) and quint-traces.mjs (regenerate the committed traces).
//
// verification/quint/ is THE spec bank (behavior-pinning, replay-bound):
// lib modules are pure and test-only; machines carry two-seed trace corpora
// sized to each machine (see the companions' coverage tables).
import { spawnSync } from 'node:child_process';

export const BASE_SEED = '0x67c0de2026';
export const SECOND_SEED = '0xfab1e2026';

const machine = (name, { main, nTraces, maxSteps }) => ({
  name,
  path: `verification/quint/${name}.qnt`,
  main,
  invariant: 'allInvariants',
  traces: {
    dir: `verification/quint/traces/${name}`,
    nTraces,
    maxSteps,
    seeds: [BASE_SEED, SECOND_SEED],
    seedTag: true
  }
});

export const SPECS = [
  // lib: pure semantics modules, validated by their sibling test modules
  { name: 'lib/scale', path: 'verification/quint/lib/scale.qnt', testMain: 'scale_test' },
  { name: 'lib/printer-core', path: 'verification/quint/lib/printer-core.qnt', testMain: 'printer_core_test' },
  // machines
  machine('streaming', { nTraces: 20, maxSteps: 40 }),
  machine('interpreter', { nTraces: 25, maxSteps: 30 }),
  machine('thumbnail', { nTraces: 25, maxSteps: 40 }),
  machine('lifecycle', { nTraces: 15, maxSteps: 30 }),
  machine('layer-indexer', { nTraces: 25, maxSteps: 30 }),
  machine('slicer-detector', { nTraces: 40, maxSteps: 10 }),
  machine('encoding-equivalence', { main: 'encoding_equivalence', nTraces: 12, maxSteps: 30 })
];

export const quint = (args, { allowFail = false } = {}) => {
  const result = spawnSync('npx', ['quint', ...args], { stdio: 'inherit' });
  if (result.status !== 0 && !allowFail) process.exit(result.status ?? 1);
  return result.status ?? 1;
};

export const seedTag = (seed) => `s${seed.replace(/^0x/, '')}`;

/** The exact per-seed trace-generation argument lists for a spec. */
export const traceGenArgs = (spec, outDir) =>
  spec.traces.seeds.map((seed) => {
    const pattern = spec.traces.seedTag ? `trace_${seedTag(seed)}_{seq}.itf.json` : 'trace_{seq}.itf.json';
    return [
      'run',
      spec.path,
      ...(spec.main ? ['--main', spec.main] : []),
      '--invariant',
      spec.invariant,
      '--max-samples',
      String(spec.traces.nTraces),
      '--n-traces',
      String(spec.traces.nTraces),
      '--max-steps',
      String(spec.traces.maxSteps),
      `--seed=${seed}`,
      '--out-itf',
      `${outDir}/${pattern}`,
      '--verbosity',
      '1'
    ];
  });

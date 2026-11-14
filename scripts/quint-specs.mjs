// Manifest of every Quint spec the runners drive, plus shared helpers.
// Entry points: quint-check.mjs (tests + invariant simulation + trace
// freshness) and quint-traces.mjs (regenerate the committed traces).
//
// v1 (verification/quint/) is the behavior-pinning bank: uniform budgets,
// single seed. v2 (verification/quint-v2/) sizes each machine's corpus to its
// diameter and samples two seeds; lib modules are pure and test-only.
import { spawnSync } from 'node:child_process';

export const BASE_SEED = '0x67c0de2026';
export const SECOND_SEED = '0xfab1e2026';

const v1 = (name) => ({
  name: `v1/${name}`,
  path: `verification/quint/${name}.qnt`,
  invariant: 'allInvariants',
  traces: {
    dir: `verification/quint/traces/${name}`,
    nTraces: 15,
    maxSteps: 24,
    seeds: [BASE_SEED],
    seedTag: false
  }
});

const v2 = (name, { main, nTraces, maxSteps }) => ({
  name: `v2/${name}`,
  path: `verification/quint-v2/${name}.qnt`,
  main,
  invariant: 'allInvariants',
  traces: {
    dir: `verification/quint-v2/traces/${name}`,
    nTraces,
    maxSteps,
    seeds: [BASE_SEED, SECOND_SEED],
    seedTag: true
  }
});

export const SPECS = [
  v1('encoding-equivalence'),
  v1('interpreter'),
  v1('layer-indexer'),
  v1('lifecycle'),
  v1('slicer-detector'),
  v1('streaming'),
  v1('thumbnail'),
  // v2 lib: pure semantics modules, validated by their sibling test modules
  { name: 'v2/lib/scale', path: 'verification/quint-v2/lib/scale.qnt', testMain: 'scale_test' },
  { name: 'v2/lib/printer-core', path: 'verification/quint-v2/lib/printer-core.qnt', testMain: 'printer_core_test' },
  // v2 machines: budgets sized per machine (see each companion's coverage table)
  v2('streaming', { nTraces: 20, maxSteps: 40 }),
  v2('interpreter', { nTraces: 25, maxSteps: 30 }),
  v2('encoding-equivalence', { main: 'encoding_equivalence', nTraces: 12, maxSteps: 30 })
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

// Regenerates the committed ITF traces for every Quint spec under
// verification/quint/ into verification/quint/traces/<spec>/. The seed is
// fixed, so regeneration is reproducible (only the #meta timestamp in each
// file header changes).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUINT_DIR, SEED, specs, quint } from './quint-check.mjs';

for (const spec of specs()) {
  const tracesDir = join(QUINT_DIR, 'traces', spec.name);
  mkdirSync(tracesDir, { recursive: true });
  console.log(`\n=== ${spec.name} -> ${tracesDir} ===`);
  quint([
    'run',
    spec.path,
    '--out-itf',
    join(tracesDir, 'trace_{seq}.itf.json'),
    '--n-traces',
    '15',
    '--max-samples',
    '15',
    '--max-steps',
    '24',
    '--seed',
    SEED,
    '--verbosity',
    '1'
  ]);
}

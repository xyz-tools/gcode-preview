// Regenerates the committed ITF traces for every spec in the manifest.
// Seeds and budgets are pinned there, so regeneration is reproducible
// (only the #meta timestamp in each file header changes).
import { mkdirSync } from 'node:fs';
import { SPECS, quint, traceGenArgs } from './quint-specs.mjs';

for (const spec of SPECS) {
  if (!spec.traces) continue;
  mkdirSync(spec.traces.dir, { recursive: true });
  console.log(`\n=== ${spec.name} -> ${spec.traces.dir} ===`);
  for (const args of traceGenArgs(spec, spec.traces.dir)) quint(args);
}

/**
 * Tier-1 (deterministic) grading of a results directory.
 *
 *   npm run evals:grade -- results/2026-09-07-opus-skill
 *
 * Checks only what a regex can settle: did the run name the expected file, carry a
 * severity tag, and stay silent where silence was required. Whether a finding describes
 * the *actual* defect is tier 2 — see README.md, "Grading".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, expectsSilence, type EvalCase } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) throw new Error('usage: npm run evals:grade -- results/<dir>');
const resultsDir = isAbsolute(arg) ? arg : join(here, arg.replace(/^evals\//, ''));

const byId = new Map<string, EvalCase>(loadCases(join(here, 'cases')).map((c) => [c.id, c]));
const SEVERITY = /\[(critical|major|minor|process)\]/g;

interface Row {
  id: string;
  run: string;
  fileHit: string;
  findings: number;
  verdict: string;
  pass: boolean;
}
const rows: Row[] = [];

for (const name of readdirSync(resultsDir).sort()) {
  const m = name.match(/^(.+)\.run(\d+)\.md$/);
  if (!m) continue;
  const [, id, run] = m;
  const c = byId.get(id);
  if (!c) {
    console.warn(`no case for result "${name}"`);
    continue;
  }

  const body = readFileSync(join(resultsDir, name), 'utf8');
  const findings = (body.match(SEVERITY) ?? []).length;

  if (expectsSilence(c)) {
    const pass = findings === 0;
    rows.push({
      id,
      run,
      fileHit: '—',
      findings,
      pass,
      verdict: pass ? 'PASS' : `FAIL — invented ${findings} finding(s)`
    });
    continue;
  }

  const wanted = c.must_find[0].file;
  const fileHit = body.includes(wanted);
  const pass = fileHit && findings > 0;
  rows.push({
    id,
    run,
    fileHit: fileHit ? 'yes' : 'no',
    findings,
    pass,
    verdict: pass
      ? 'PASS (tier-2 pending)'
      : `FAIL — ${!fileHit ? `never named ${wanted}` : 'no severity-tagged finding'}`
  });
}

if (rows.length === 0) throw new Error(`no run output found in ${resultsDir}`);

const w = (k: keyof Row, min: number) => Math.max(min, ...rows.map((r) => String(r[k]).length));
const [wid, wrun] = [w('id', 4), w('run', 3)];
console.log(`${'CASE'.padEnd(wid)}  ${'RUN'.padEnd(wrun)}  FILE  FINDINGS  VERDICT`);
for (const r of rows) {
  console.log(
    `${r.id.padEnd(wid)}  ${r.run.padEnd(wrun)}  ${r.fileHit.padEnd(4)}  ${String(r.findings).padEnd(8)}  ${r.verdict}`
  );
}

const passed = rows.filter((r) => r.pass).length;
console.log(`\ntier-1: ${passed}/${rows.length} passed`);
console.log('Extra findings beyond must_find are NOT failures — triage them by hand (README, "Scoring").');
if (passed < rows.length) process.exitCode = 1;

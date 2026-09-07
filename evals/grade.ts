/**
 * Tier-1 (deterministic) grading of a results directory.
 *
 *   npm run evals:grade -- results/2026-09-07-opus-skill
 *
 * Two independent signals, deliberately kept apart:
 *
 *   DETECT  did the review point at the right file? Format-neutral, so a skill run and a
 *           baseline run are judged on the same terms. This is the pass criterion.
 *   FORMAT  did it use the skill's severity tags? Only the skill mandates these, so this
 *           is reported for information and never decides a verdict — an earlier version
 *           conflated the two and scored the baseline 1/5 for prose it had got right.
 *
 * Whether a finding describes the *actual* defect is tier 2 — see README.md, "Grading".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectsSilence, loadCases, type EvalCase } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) throw new Error('usage: npm run evals:grade -- results/<dir>');
const resultsDir = isAbsolute(arg) ? arg : join(here, arg.replace(/^evals\//, ''));
const isBaseline = basename(resultsDir).endsWith('-baseline');

const byId = new Map<string, EvalCase>(loadCases(join(here, 'cases')).map((c) => [c.id, c]));
const SEVERITY = /\[(critical|major|minor|process)\]/g;

interface Row {
  id: string;
  run: string;
  detect: string;
  tags: number;
  verdict: string;
  pass: boolean | null;
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
  const tags = (body.match(SEVERITY) ?? []).length;

  if (expectsSilence(c)) {
    // A baseline run has no prescribed format, so "reported nothing" is not machine-decidable.
    if (isBaseline) {
      rows.push({ id, run, detect: '—', tags, verdict: 'MANUAL (no format to check)', pass: null });
    } else {
      const pass = tags === 0;
      rows.push({
        id,
        run,
        detect: '—',
        tags,
        pass,
        verdict: pass ? 'PASS' : `FAIL — invented ${tags} finding(s)`
      });
    }
    continue;
  }

  // Detection is format-neutral: accept the full path or the bare filename.
  const wanted = c.must_find[0].file;
  const pass = body.includes(wanted) || body.includes(basename(wanted));
  rows.push({
    id,
    run,
    detect: pass ? 'yes' : 'no',
    tags,
    pass,
    verdict: pass ? 'PASS (tier-2 pending)' : `FAIL — never named ${basename(wanted)}`
  });
}

if (rows.length === 0) throw new Error(`no run output found in ${resultsDir}`);

const width = (k: keyof Row, min: number) => Math.max(min, ...rows.map((r) => String(r[k]).length));
const [wid, wrun] = [width('id', 4), width('run', 3)];
console.log(`${isBaseline ? 'BASELINE (no skill)' : 'SKILL'} — ${basename(resultsDir)}\n`);
console.log(`${'CASE'.padEnd(wid)}  ${'RUN'.padEnd(wrun)}  DETECT  TAGS  VERDICT`);
for (const r of rows) {
  console.log(
    `${r.id.padEnd(wid)}  ${r.run.padEnd(wrun)}  ${r.detect.padEnd(6)}  ${String(r.tags).padEnd(4)}  ${r.verdict}`
  );
}

const scored = rows.filter((r) => r.pass !== null);
const passed = scored.filter((r) => r.pass).length;
const manual = rows.length - scored.length;
console.log(`\ntier-1 detection: ${passed}/${scored.length} passed${manual ? ` (${manual} need manual review)` : ''}`);
console.log('TAGS is reported for information only and never decides a verdict.');
console.log('Extra findings beyond must_find are NOT failures — triage them by hand (README, "Scoring").');
if (passed < scored.length) process.exitCode = 1;

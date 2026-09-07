/**
 * Runs the lessons-learned-review evals.
 *
 *   npm run evals                                  all cases, with the skill
 *   npm run evals -- --baseline                    all cases, no skill
 *   npm run evals -- --case 392-truthy-e --runs 5
 *
 * Every run is a fresh `claude -p` process, so no case can leak into another.
 * The patch is staged into a temp directory; case.json stays behind in the repo
 * so the expected answers are never within the agent's reach.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCases } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    baseline: { type: 'boolean', default: false },
    case: { type: 'string' },
    runs: { type: 'string' },
    model: { type: 'string', default: process.env.EVAL_MODEL ?? 'opus' }
  }
});

const mode = values.baseline ? 'baseline' : 'skill';
const cases = loadCases(join(here, 'cases'), values.case);
if (cases.length === 0) throw new Error(`no cases matched${values.case ? ` "${values.case}"` : ''}`);

const stamp = new Date().toISOString().slice(0, 10);
const outDir = join(here, 'results', `${stamp}-${values.model}-${mode}`);
mkdirSync(outDir, { recursive: true });

function promptFor(patch: string, skill: string): string {
  const target = `the proposed change in ${patch}`;
  const shared =
    `It is a proposed change to this repository; read the surrounding source in the repo for context. ` +
    `Output the review only — do not modify any file and do not post anything anywhere.`;
  return mode === 'skill'
    ? `Use the ${skill} skill to review ${target}. ${shared}`
    : `Review ${target} for bugs. ${shared}`;
}

let failures = 0;
for (const c of cases) {
  const runs = values.runs ? Number(values.runs) : c.runs;
  for (let i = 1; i <= runs; i++) {
    const work = mkdtempSync(join(tmpdir(), `eval-${c.id}-`));
    const patch = join(work, 'proposed.patch');
    copyFileSync(join(here, 'cases', c.id, 'diff.patch'), patch);

    process.stdout.write(`run ${c.id} [${mode} ${i}/${runs}] `);
    const started = Date.now();
    const res = spawnSync(
      'claude',
      [
        '-p',
        promptFor(patch, c.skill),
        '--model',
        String(values.model),
        '--allowedTools',
        'Read',
        'Grep',
        'Glob',
        'Bash',
        'Skill'
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    rmSync(work, { recursive: true, force: true });

    const secs = Math.round((Date.now() - started) / 1000);
    if (res.status !== 0 || !res.stdout?.trim()) {
      failures++;
      console.log(`FAILED (${secs}s)`);
      writeFileSync(join(outDir, `${c.id}.run${i}.err`), res.stderr ?? 'no stderr');
      continue;
    }
    writeFileSync(join(outDir, `${c.id}.run${i}.md`), res.stdout);
    console.log(`ok (${secs}s)`);
  }
}

console.log(`\nresults in ${outDir.replace(`${here}/`, '')}`);
if (failures) {
  console.log(`${failures} run(s) failed to execute — see the .err files`);
  process.exitCode = 1;
}

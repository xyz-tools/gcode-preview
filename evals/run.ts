/**
 * Runs the lessons-learned-review evals.
 *
 *   npm run evals                                  all cases, with the skill
 *   npm run evals -- --baseline                    all cases, no skill
 *   npm run evals -- --case 392-truthy-e --runs 5
 *
 * Every run is a fresh `claude -p` in its own sandbox, so no case can leak into
 * another and no run can read the answer. See `sandbox()` for what that means.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCases } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const { values } = parseArgs({
  options: {
    baseline: { type: 'boolean', default: false },
    case: { type: 'string' },
    runs: { type: 'string' },
    model: { type: 'string', default: process.env.EVAL_MODEL ?? 'opus' },
    // Build each sandbox, print where it is, and stop before spawning the agent.
    // Lets you inspect what a run can actually see without spending tokens.
    'dry-run': { type: 'boolean', default: false }
  }
});

const mode = values.baseline ? 'baseline' : 'skill';
const cases = loadCases(join(here, 'cases'), values.case);
if (cases.length === 0) throw new Error(`no cases matched${values.case ? ` "${values.case}"` : ''}`);

const stamp = new Date().toISOString().slice(0, 10);
const outDir = join(here, 'results', `${stamp}-${values.model}-${mode}`);
mkdirSync(outDir, { recursive: true });

/**
 * Builds the checkout the agent reviews against, and returns its path.
 *
 * The agent needs to read surrounding source to review a diff, so it gets a repo —
 * but not *this* repo. Reviewing against the live worktree let a run open the file
 * the fixture had un-fixed and read the corrected line straight off disk, which is a
 * better answer key than case.json ever was. So the sandbox is:
 *
 * - a `git archive` export of HEAD, i.e. tracked files only and **no `.git`**, so
 *   `git log`/`git show` cannot surface the fix either;
 * - with `evals/` removed, since that is where case.json states the expected finding;
 * - with `pre.patch` applied, stripping the comment that explains the invariant the
 *   fixture is about to break. Fixtures are inverted fixes, so that comment was
 *   written by the very fix being undone — leaving it in hands the run a hint the
 *   original reviewer never had. Deleting it inside `diff.patch` instead is worse:
 *   a removed comment narrating the bug is a louder signpost than the bug itself.
 *
 * `.claude/skills` is a tracked symlink to `.agents/`, so the skill under test comes
 * along with the export and resolves normally. node_modules does not, which is fine:
 * these runs review code, they do not build or test it.
 */
function sandbox(caseId: string): string {
  const work = mkdtempSync(join(tmpdir(), `eval-${caseId}-`));
  const tar = join(work, 'repo.tar');
  const root = join(work, 'repo');
  mkdirSync(root);

  execFileSync('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: repoRoot });
  execFileSync('tar', ['-x', '-f', tar, '-C', root]);
  rmSync(tar);
  rmSync(join(root, 'evals'), { recursive: true, force: true });

  const pre = join(here, 'cases', caseId, 'pre.patch');
  if (existsSync(pre)) {
    execFileSync('patch', ['-p1', '-s', '--forward', '-d', root], { input: readFileSync(pre) });
  }
  copyPatch(caseId, root);
  return root;
}

function copyPatch(caseId: string, root: string): void {
  writeFileSync(join(root, 'proposed.patch'), readFileSync(join(here, 'cases', caseId, 'diff.patch')));
}

function promptFor(skill: string): string {
  const target = 'the proposed change in ./proposed.patch';
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
    const root = sandbox(c.id);
    if (values['dry-run']) {
      console.log(`dry-run ${c.id}: ${root}`);
      break;
    }

    process.stdout.write(`run ${c.id} [${mode} ${i}/${runs}] `);
    const started = Date.now();
    const res = spawnSync(
      'claude',
      [
        '-p',
        promptFor(c.skill),
        '--model',
        String(values.model),
        '--allowedTools',
        'Read',
        'Grep',
        'Glob',
        'Bash',
        'Skill'
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    rmSync(dirname(root), { recursive: true, force: true });

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

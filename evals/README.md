# lessons-learned-review evals

A regression detector for the `lessons-learned-review` skill. It answers one question:
**does the skill still catch the mistakes it was built from?**

It is not a benchmark. Five cases at three runs is too small, and the grading too
subjective, to support a claim like "the skill is 87% accurate."

## Architecture

```
types.ts                 Case schema + loader (validates every case.json)
run.ts                   runner — one fresh `claude -p` per run
grade.ts                 grader — tier 1, deterministic
cases/<id>/pre.patch     optional: applied to the sandbox before the agent looks
cases/<id>/diff.patch    frozen fixture: a proposed change to this repo
cases/<id>/case.json     what a correct review must find, and how to grade it
results/<date-model-mode>/   captured output — gitignored, local to your machine
```

**Fixtures.** Each defect case injects a real historical bug into today's code, so the
patch reads like a change someone might actually propose. Sources are named in
`case.json` (`392-truthy-e` is PR #392, and so on). The clean case is a harmless docs
edit whose correct review is *no findings at all* — it guards against inventing
problems to look useful.

Because the fixtures are inverted fixes, the comment explaining an invariant was written
by the very fix a fixture undoes. Leaving it in hands the run a hint the original reviewer
never had, and deleting it *inside* `diff.patch` is worse still: a `-` line narrating the
bug beside the `+` line introducing it is a louder signpost than the defect. So each
defect case strips those comments in `pre.patch`, applied to the sandbox before the agent
looks — they appear in neither the diff nor the surrounding source. `loadCases` refuses to
load a defect case whose `diff.patch` deletes a comment line.

**Isolation.** Every run is a separate `claude -p` process in its own sandbox, so no case
can leak into another and no run can read the answer. The sandbox is a `git archive`
export of `HEAD` — tracked files only and **no `.git`**, so neither the working tree nor
the fix history is reachable — with `evals/` deleted (that is where `case.json` states the
expected finding) and `pre.patch` applied. `.claude/skills` is a tracked symlink into
`.agents/`, so the skill under test comes along and resolves normally. `node_modules` does
not, which is fine: these runs review code, they do not build or test it.

Inspect exactly what a run can see with `npm run evals -- --dry-run`, which builds each
sandbox, prints its path and stops before spawning the agent.

## Running

```bash
npm run evals                                   # all cases, with the skill
npm run evals -- --baseline                     # all cases, no skill — the comparison that matters
npm run evals -- --case 392-truthy-e --runs 5
npm run evals:grade -- results/2026-09-07-opus-skill
```

Run with `node --experimental-strip-types` (Node >= 22.6), so the suite adds no
dependencies. Evals are deliberately **not** vitest tests: they are non-deterministic,
cost real tokens, and are graded rather than asserted, so `npm test` must never run them.

Costs real tokens and is non-deterministic, so it is not wired into PR CI. Run it when
the skill changes. Output under `results/` is gitignored: it is bulky, varies run to run,
and would only add diff noise. Record anything worth keeping as a short summary in the
PR that changed the skill.

## Grading

**Tier 1 (`grade.ts`, deterministic).** Did the review name the expected file, carry a
severity tag, and stay silent on the clean case? Cheap, and enough to catch a skill that
has stopped working.

**Tier 2 (human or LLM judge).** Did it describe *the actual defect mechanism*? Each
`case.json` carries a `grading_note` setting the bar — for `364-boundingbox-nan`, the run
must explain NaN persistence, not merely observe that a guard was deleted. Naming the
right file for the wrong reason is not a hit.

`grading_note` predates the sandbox: it was added when fixtures still deleted the
explanatory comment, to stop a run scoring a hit off that hint alone. The hint is gone
now, but the bar it set is still the right one.

## What these cases do and don't measure

A first run (2026-09-07, opus, one run per case) found **skill 5/5 detection, baseline
4/4** — but that was collected before the sandbox existed, when a run could open the file
the fixture had un-fixed and read the corrected line straight off disk. Near-perfect scores
are exactly what that produces, so **those numbers are withdrawn** and no skill-vs-baseline
claim survives them. Re-baseline before comparing anything.

Where the skill did differ, on real PRs, was in *coverage and discipline* — running every
relevant class rather than the one that catches the eye, measuring claims against
`demo/gcodes`, and holding a consistent report shape. None of that is what a
single-defect fixture tests.

To discriminate, a case needs to look like real work: a multi-file change where the defect
is a side effect nobody signposted — a demo control quietly turned into a no-op, a path
count that explodes on real files. Those are harder to build and are the obvious next step.

## Scoring

- **Detection** — did the review name the expected file? Format-neutral, so skill and
  baseline runs are judged identically. This is the pass criterion.
- **Format compliance** — severity tags and report shape. Reported for information only:
  an earlier grader made tags a pass condition and scored the baseline 1/5 for prose it
  had actually got right.
- **False positives** on `clean-docs-only` — the guard. Any finding there is a failure.
- **Extra findings** — logged for triage, **never scored as failures**. On PR #458 the
  skill found three real bugs beyond the one being probed; an eval that punished those
  would train it toward under-reporting.

## Adding a case

1. Pick a bug from `.context/pr-bug-audit.md` with a known fix.
2. Inject it into current code and generate the patch with
   `diff -u --label a/<path> --label b/<path>`, prefixed by a `diff --git` line.
3. Move any comment that explains the invariant into `cases/<id>/pre.patch`, so the
   reviewed diff carries the code change alone. `loadCases` enforces this.
4. Verify both apply in order, against a sandbox rather than the worktree:
   `npm run evals -- --dry-run --case <id>`.
5. Write `case.json` with `must_find`, `expected_classes`, and a `grading_note` that
   names the mechanism a real hit must describe.

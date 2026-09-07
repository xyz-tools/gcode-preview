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
cases/<id>/diff.patch    frozen fixture: a proposed change to this repo
cases/<id>/case.json     what a correct review must find, and how to grade it
results/<date-model-mode>/   captured output — gitignored, local to your machine
```

**Fixtures.** Each defect case injects a real historical bug into today's code, so the
patch reads like a change someone might actually propose. Sources are named in
`case.json` (`392-truthy-e` is PR #392, and so on). The clean case is a harmless docs
edit whose correct review is *no findings at all* — it guards against inventing
problems to look useful.

**Isolation.** Every run is a separate `claude -p` process, so no case can leak into
another. `run.sh` copies `diff.patch` into a temp directory and points the agent there;
`case.json` stays behind in the repo so the answers are never in reach.

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

Because the fixtures are inverted fixes, some cases also delete an explanatory comment.
That is a hint the original author would not have had. The `grading_note` exists to stop
a run passing on the hint alone.

## What these cases do and don't measure

A first run (2026-09-07, opus, one run per case) found **skill 5/5 detection, baseline 4/4**.
On these fixtures the skill shows no detection advantage, and that is a fact about the
fixtures rather than a verdict on the skill: each one plants a single obvious defect and
removes the comment that explained it, which a capable model spots unaided.

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
3. Verify it applies: `git apply --check cases/<id>/diff.patch`.
4. Write `case.json` with `must_find`, `expected_classes`, and a `grading_note` that
   names the mechanism a real hit must describe.

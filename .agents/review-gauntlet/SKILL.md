---
name: review-gauntlet
description: Reviews a branch, PR, or working-tree diff for the defect classes that have shipped real bugs in this repo — falsy-zero, NaN propagation, streaming chunk boundaries, loop/index errors, leaks and init order, public API breaks, weak tests, per-render allocations, unguarded optional config, dead demo controls, CI workflows, undisclosed behavior changes, and G-code spec conformance. Use when reviewing changes before merge, or when the user asks for a review of one specific class.
---

# Review Gauntlet

Applies the relevant defect-class checklists to a set of changes and merges the results into one report. Each class is backed by bugs that actually shipped here, so its checklist is calibrated by real incidents rather than generic advice.

## 1. Resolve the target first

Do not assume the work is on GitHub. Assess, in this order, and state which case you landed on:

1. **The user named an explicit target** (a PR number, branch, or paths) — review that.
2. **A PR exists for the current branch** — check with `gh pr view --json number,title,headRefName` (no arguments). If one exists, use it for context (title, body, disclosed behavior changes) but still review the code.
3. **Local branch only, no PR yet** — the common case mid-work. Review `git diff origin/develop...` (or the merge-base against whatever the target branch is). There is nothing to fetch and nothing to post.
4. **Uncommitted work** — if `git status` shows relevant unstaged/staged changes, include them (`git diff` / `git diff --cached`); say so in the report.

Getting the code:
- Always start with `git diff --stat <base>...` to see the shape of the change.
- For a PR that is not the current branch, read it with `gh pr diff <N>` and fetch individual files at the head ref via `gh api`.
- **Never mutate the working tree to review.** No `gh pr checkout`, no `git checkout`, no stash. This runs inside live worktrees that may hold uncommitted work.
- Read enough surrounding code of each changed file to judge correctness — not just the diff hunks.

## 2. Select the relevant classes

Read only the reference files for the classes the diff can plausibly break:

- [falsy-zero](reference/falsy-zero.md) — `||`/truthy checks where 0 is legitimate (X/Y/Z/E/T, indices, layers)
- [nan-guards](reference/nan-guards.md) — NaN/non-finite reaching state, buffers, BoundingBox, camera math
- [streaming-chunks](reference/streaming-chunks.md) — parser state lost at chunk boundaries, tail flush, newline off-by-ones
- [loop-index](reference/loop-index.md) — splice-in-loop, one cursor across index spaces, `<` vs `<=` bounds
- [lifecycle-dispose](reference/lifecycle-dispose.md) — undisposed resources, disposables growth, constructor init order
- [public-api](reference/public-api.md) — new exports need rationale, `@deprecated` aliases on renames, v2.x contracts
- [test-rigor](reference/test-rigor.md) — red-first regression, real code path, behavior-asserting tests
- [render-allocations](reference/render-allocations.md) — per-render allocations, repeated derived-data calls, hidden copies
- [optional-guards](reference/optional-guards.md) — unguarded access on optional config (buildVolume, tool colors, devgui)
- [demo-impact](reference/demo-impact.md) — options/controls/presets the change silently turns into no-ops
- [workflows](reference/workflows.md) — CI ref checkout, permissions blocks, publish/provenance config
- [behavior-changes](reference/behavior-changes.md) — same input, different output, undisclosed in the PR body
- [gcode-spec](reference/gcode-spec.md) — command handlers vs documented firmware semantics (Marlin/Smoothieware/RRF)

Map changed files to classes; when in doubt, include:

- `src/parser/`, `src/interpreter*`, `src/state.ts` → falsy-zero, nan-guards, streaming-chunks, gcode-spec, loop-index
- `src/job.ts`, `src/indexers.ts`, `src/path.ts`, `src/bounding-box.ts` → loop-index, nan-guards, falsy-zero
- `src/objects-manager.ts`, `src/scene-manager.ts`, `src/extrusion-geometry.ts`, `src/gcode-preview.ts` render paths → render-allocations, lifecycle-dispose, optional-guards
- `src/dev-gui.ts`, `src/build-volume.ts`, options/config types → optional-guards, lifecycle-dispose, demo-impact
- exports / `index.ts` / public method signatures → public-api, behavior-changes
- any change to how an option, default, or slicer value is resolved → demo-impact
- `.github/`, `package.json` publish fields → workflows
- any bug fix or `src/__tests__/` change → test-rigor
- **always** include behavior-changes for src/ diffs

If the user asked for one specific class, read only that file and report only its findings.

## 3. Execute

**Sequential, one class at a time, by you.** Apply each selected class's checklist on its own — do not blend them into one vague pass. This is faster and has produced better reviews than fanning out to sub-agents.

Fan out sub-agents only for a very large diff (roughly 20+ changed source files). If you do: collect their results **synchronously**, never end your turn to wait on notifications or monitors, apply a stalled reviewer's checklist yourself rather than re-spawning, and do not arm monitors to watch your own sub-agents — they fire late and duplicate the report.

**Verify empirically where it is cheap.** A measured finding beats a reasoned one:
- **Count real occurrences** against the repo's own fixtures — e.g. `grep -c '^;WIDTH:' demo/gcodes/3DBenchy.gcode` turned "this may create extra paths" into "3,511 → 34,273 paths, 9.8x".
- **Run the tests / typecheck** when the code is local (`bin/check`, or the suite for the touched area).
- **Mutate to confirm a test gap** — if you claim a test only enforces execution, flip the sign or the constant and confirm it stays green.
- **Measure performance claims** against the baseline harness in `.context/bench`.

Put the number in the finding's Example. If you could not verify something, say so rather than implying you did.

## 4. Finding format

Every finding carries a severity tag and exactly three parts. Keep each part to 1–3 short lines — no essays.

Severity tags:
- **[critical]** — crash, data loss, or corrupted output
- **[major]** — wrong render/output, silent no-op, broken public contract
- **[minor]** — performance regression, leak that grows slowly
- **[process]** — test rigor, disclosure, docs, hygiene

Each finding:
- **Problem** — `file:line` and one sentence naming the defect.
- **Example** — the concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "`G1 Z0` → `z || state.z` keeps the previous Z → garbled preview").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

## 5. Report structure

1. **Findings** — severity-ranked across all classes, deduplicated: a line flagged by two classes is one finding tagged with both.
2. **Latent (no failure today)** — real defects that cannot currently misbehave because something upstream masks them, with the condition that would expose them. Do not inflate these into findings.
3. **Out of scope / pre-existing** — genuine bugs this change did not introduce or touch, clearly separated so the author is not asked to fix them here. Offer to file them as issues.
4. **Classes run vs skipped** — a table covering every class you considered: the finding numbers it produced, `nothing found`, or `skipped — <reason>`, one line of justification each.

No padding: report only genuine findings; a clean class gets one table row, not a paragraph.

## 6. Output protocol

1. **The review is the response.** Always output the full structured review as your response text first, so the user reads it in the conversation before anything else happens.
2. **Nothing is posted to GitHub without confirmation.** Posting PR comments, reviews, or issues on the user's behalf requires an explicit confirmation step AFTER the review has been shown: state exactly what would be posted and where ("post these N findings as inline comments on PR #X?") and wait for the user's yes. Never post as a side effect of running a review, and never post more than what was confirmed.
3. **Prefer inline comments.** When posting is confirmed, default to one inline review comment per finding, anchored at its `file:line`, plus a short summary comment carrying the classes-run table and any out-of-scope notes. Use a single combined comment only if the user asks for it or the findings have no stable line anchors.
4. If the target has no PR (local-branch review), there is nothing to post — say so instead of offering.

---
name: review-checklist
description: Meta skill defining the review standard for all review-* skills — how to resolve what to review, the master defect checklist, empirical verification, the Problem/Example/Recommendation finding format with severity tags, and the output protocol (review shown in the response first; explicit confirmation before posting anything to GitHub). Load alongside any review skill, or whenever asked to review changes.
---

# Review checklist & standard

This skill defines HOW reviews are run and reported. The focused `review-*` skills define WHAT to hunt. Every review — single-class or full gauntlet — follows this standard.

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

## 2. Master checklist

Work through the classes relevant to the changed files (each has a focused skill at `.claude/skills/<name>/SKILL.md` with hunt lists, known incidents, and heuristics):

- [ ] `review-falsy-zero` — `||`/truthy checks where 0 is legitimate (X/Y/Z/E/T, indices, layers)
- [ ] `review-nan-guards` — NaN/non-finite reaching state, buffers, BoundingBox, camera math
- [ ] `review-streaming-chunks` — parser state lost at chunk boundaries, tail flush, newline off-by-ones
- [ ] `review-loop-index` — splice-in-loop, one cursor across index spaces, `<` vs `<=` bounds
- [ ] `review-lifecycle-dispose` — undisposed resources, disposables growth, constructor init order
- [ ] `review-public-api` — new exports need rationale, `@deprecated` aliases on renames, v2.x contracts
- [ ] `review-test-rigor` — red-first regression, real code path, behavior-asserting tests
- [ ] `review-render-allocations` — per-render allocations, repeated derived-data calls, hidden copies
- [ ] `review-optional-guards` — unguarded access on optional config (buildVolume, tool colors, devgui)
- [ ] `review-demo-impact` — options/controls/presets the change silently turns into no-ops
- [ ] `review-workflows` — CI ref checkout, permissions blocks, publish/provenance config
- [ ] `review-behavior-changes` — same input, different output, undisclosed in the PR body
- [ ] `review-gcode-spec` — command handlers vs documented firmware semantics (Marlin/Smoothieware/RRF)

Skip classes irrelevant to the diff, but report which were run and which were skipped.

## 3. Verify empirically where it is cheap

A measured finding beats a reasoned one. Before reporting anything you could check, check it:

- **Count real occurrences** against the repo's own fixtures — e.g. `grep -c '^;WIDTH:' demo/gcodes/3DBenchy.gcode` turned "this may create extra paths" into "3,511 → 34,273 paths, 9.8x".
- **Run the tests / typecheck** when the code is local (`bin/check`, or the suite for the touched area). Both are free signal and catch things static reading misses.
- **Mutate to confirm a test gap** — if you claim a test only enforces execution, flip the sign or the constant and confirm it stays green.
- **Measure performance claims** against the baseline harness in `.context/bench` rather than asserting a regression.

Put the number in the finding's Example. If you could not verify something, say so rather than implying you did.

## 4. Finding format

Every finding has a severity tag and exactly three parts. Keep each part to 1–3 short lines — no essays.

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

1. **Findings** — severity-ranked, deduplicated (one finding per defect, tagged with every class that flagged it).
2. **Latent (no failure today)** — real defects that cannot currently misbehave because something upstream masks them. Same format, flagged as latent, with the condition that would expose them. Do not inflate these into findings.
3. **Out of scope / pre-existing** — genuine bugs you noticed that this change did not introduce or touch. Same format, clearly separated so the author is not asked to fix them here. Offer to file them as issues.
4. **Classes run vs skipped** — a table, one row per class: the finding numbers it produced, or `nothing found`, or `skipped — <reason>`. One line of justification each.

No padding: report only genuine findings; a clean class gets one table row, not a paragraph.

## 6. Output protocol

1. **The review is the response.** Always output the full structured review as the agent's response text first, so the user reads it in the conversation before anything else happens.
2. **Nothing is posted to GitHub without confirmation.** Posting PR comments, reviews, or issues on the user's behalf requires an explicit confirmation step AFTER the review has been shown: state exactly what would be posted and where ("post these N findings as inline comments on PR #X?") and wait for the user's yes. Never post as a side effect of running a review, and never post more than what was confirmed.
3. **Prefer inline comments.** When posting is confirmed, default to one inline review comment per finding, anchored at its `file:line`, plus a short summary comment carrying the classes-run table and any out-of-scope notes. Use a single combined comment only if the user asks for it or the findings have no stable line anchors.
4. If the target has no PR (local-branch review), there is nothing to post — say so instead of offering.

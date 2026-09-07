---
name: review-loop-index
description: Reviews changes for loop and index hygiene bugs (splice-in-loop, shared cursors across index spaces, off-by-one bounds, double-indexing on re-entry). Use when reviewing changes touching Job indexers, render loops, path/array iteration, or resume logic.
---

# Loop & Index Hygiene Review

Focused code review of the current changes for ONE class of defect: loop and index errors — mutation during iteration, cursors spanning multiple index spaces, boundary off-by-ones, and re-entrant double-indexing. Report findings only for this class — no general style feedback.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks.

## What to hunt
- Mutating an array while iterating it: `splice` inside `for`/`forEach` over the same array skips the next element (Job's `indexPath` did exactly this to its indexer list). Iterate a copy, iterate backwards, or collect-then-remove.
- One cursor/index used across multiple arrays or index spaces — e.g. a single `renderPathIndex` walking combined paths, travels, and per-tool paths simultaneously; each space needs its own cursor or an explicit mapping.
- `<` vs `<=` (or `length` vs `length - 1`) on final-element bounds — the classic symptom here is "the last path is never drawn". Check both ends: is element 0 processed, is the final element processed exactly once?
- Resume/append logic that re-runs on re-entry (streaming chunk boundaries, `resumeLastPath`) without un-indexing or de-duplicating first — produces a duplicate entry per re-entry.
- Derived indices (layer number, tool number, buffer offset) that must stay in sync with array contents after inserts/removals — verify every mutation site updates the index.
- Chunked/tail slicing loops: off-by-one on where the kept remainder starts (see the #353 tail bug).

## Known incidents in this repo
- PR #379: three `Job` indexing bugs — `indexPath` spliced a failed indexer out of the array being iterated (skipping the next indexer; paths never rendered); `resumeLastPath` never un-indexed `toolPaths` (a duplicate `Path` per tool at every streaming chunk boundary); plus an error-handling branch bug.
- PR #391: `renderPathIndex` used one cursor across three index spaces (combined/travels/toolPaths) — travels animated at the wrong pace, per-tool slices drifted — and the loop's end bound stopped one short, never drawing the final path.
- PR #353 (tail off-by-one): `tail = str.slice(idxNewLine)` kept the newline, inflating lineCount at every chunk boundary; flagged in review but shipped anyway.

## Detection heuristics
- Grep the diff for `splice(` and check whether the enclosing loop iterates the same array.
- Grep for shared counter names (`index`, `cursor`, `i`) referenced against more than one array in the same loop body.
- For every changed `for (...; i <` / `<=` bound: hand-check the first and last iteration against a 1-element and 2-element input.
- Grep for `resume`, `append`, `push` in code reachable more than once per stream/job — is there matching removal/reset?
- Any `slice(idx)` vs `slice(idx + 1)` around separators: verify which side keeps the separator.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "two indexers, first throws → second skipped → paths never rendered").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

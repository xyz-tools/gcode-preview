# Loop & Index Hygiene Review

Defect class: loop and index errors — mutation during iteration, cursors spanning multiple index spaces, boundary off-by-ones, and re-entrant double-indexing.

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

**Example finding:** "two indexers, first throws → second skipped → paths never rendered"

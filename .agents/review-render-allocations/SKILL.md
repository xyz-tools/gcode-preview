---
name: review-render-allocations
description: Reviews changes for per-render allocations, repeated derived-data calls, and hidden buffer copies. Use when reviewing changes touching rendering, ObjectsManager, SceneManager, Job, geometry construction, or the animation loop.
---

# Render Allocation Review

Focused code review of the current changes for ONE class of defect: per-render allocations and hidden copies — work re-done or memory re-allocated on every frame/pass that should happen once. Report findings only for this class — no general style feedback.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks.

## What to hunt
- `filter`/`map`/`slice`/`concat`/spread or object/array construction inside `render()`, `animate()`, the rAF loop, `renderAnimated`, or anything called per frame or per path in ObjectsManager/SceneManager.
- The same derived-data method called repeatedly within one render pass — e.g. `job.layers()` (a full-array filter) invoked multiple times in one pass (#211); also `job.toolPaths(...)`, `state`/stats recomputation. Compute once, pass down, or go through the Job indexers.
- Hidden copies in three.js constructors: `Float32BufferAttribute` *copies* its input array (#349) — use `BufferAttribute` with an existing typed array when the data is already in the right form. Same for `setFromPoints`, `Vector3` churn in loops.
- Buffer over-allocation: hardcoded or worst-case `maxVertexCount`-style reservations (BatchedMesh) that crash or exhaust GPU memory on large files (#164). Sizes must derive from actual counts.
- Growing typed arrays by reallocating per segment/path instead of pre-counting or chunked growth.
- New `new THREE.*Geometry`/`Material` per frame or per path where one shared instance suffices.
- Premature caching added for perf: this repo has rejected caches over invalidation risk — flag caches without a clear invalidation story too.

## Known incidents in this repo
- PR #211 (caught in review): `job.layers()` — full-array filter + allocation — executed multiple times per render pass; fixed via the indexer follow-up (#220) before v3.
- PR #349: the copy the PR claimed to remove still happened because the `Float32BufferAttribute` constructor copies its input; switching to `BufferAttribute` saved ~8% more render time.
- PR #164 (caught in review): hardcoded `maxVertexCount` made BatchedMesh crash with "Reserved space request exceeds the maximum buffer size" on files >~4.5MB.

## Detection heuristics
- Grep the diff for `.filter(`, `.map(`, `.slice(`, `...` spread, `new ` inside functions named `render`, `animate`, `update`, `draw`, or bodies containing `requestAnimationFrame`.
- Grep for `Float32BufferAttribute` — almost always should be `BufferAttribute` over an existing `Float32Array`.
- Grep for `job.layers()` / `job.toolPaths(` called more than once in the same function or loop.
- Grep for numeric literals passed as buffer/vertex capacity (`maxVertexCount`, `reserve`, sizes like `1000000`).
- `push(...largeArray)` or `Array.from` on per-path vertex data inside loops.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "10MB benchy → N full-array filters per frame → progressive render stalls").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

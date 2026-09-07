---
name: review-gauntlet
description: Runs the full review battery — resolves the review target, selects the relevant focused review skills for the changed files, and merges their findings into one severity-ranked report. Use when a branch/PR is ready for a thorough pre-merge review.
---

# Review Gauntlet

Umbrella review: apply every *relevant* focused review skill to the current changes and merge the results. Each focused skill hunts one class of defect that has shipped real bugs in this repo.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Then run `git diff --stat <base>...` (or `gh pr diff <N>`) to see which files changed.

## The battery
Thirteen focused skills, each at `.claude/skills/<name>/SKILL.md`. Reporting standard for everything below: `.claude/skills/review-checklist/SKILL.md`.

- `review-falsy-zero` — `||`/truthy checks where 0 is legitimate
- `review-nan-guards` — NaN/non-finite propagation into state/buffers/camera
- `review-streaming-chunks` — chunk-boundary and stream-state bugs
- `review-loop-index` — splice-in-loop, shared cursors, off-by-one bounds
- `review-lifecycle-dispose` — leaks, disposables growth, init order
- `review-public-api` — API surface discipline, aliases, v2.x contracts
- `review-test-rigor` — red-first, real-path, behavioral tests
- `review-render-allocations` — per-render allocations and hidden copies
- `review-optional-guards` — unguarded optional config (buildVolume etc.)
- `review-demo-impact` — options/controls/presets silently turned into no-ops
- `review-workflows` — CI ref/permissions/publish correctness
- `review-behavior-changes` — undisclosed same-input/different-output changes
- `review-gcode-spec` — firmware semantics conformance

## Selecting relevant classes
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

## Execution
**Default: sequential, in one pass, by you.** Read each relevant class's SKILL.md and apply its checklist to the diff, one class at a time — do not blend them into one vague pass. This is faster and has produced better reviews than fanning out.

Fan out sub-agents only for a very large diff (roughly 20+ changed source files). If you do:
- Collect their results **synchronously** — never end your turn to wait on notifications or monitors.
- If a reviewer stalls or returns nothing, apply that class's checklist yourself instead of waiting or re-spawning.
- Do not arm monitors to watch your own sub-agents; they fire late and duplicate the report.

Verify empirically where it is cheap (section 3 of the checklist skill) — count occurrences against `demo/gcodes`, run the touched test suite, mutate a line to confirm a claimed test gap. A measured finding beats a reasoned one.

## Report format
Merge into a single report following `.claude/skills/review-checklist/SKILL.md`: severity-tagged findings as **Problem** / **Example** / **Recommendation**, ranked, deduplicated (one finding per defect, tagged with every class that flagged it), followed by the **Latent**, **Out of scope / pre-existing**, and **Classes run vs skipped** table sections.

Output the merged review as your response first, so the user reads it in the conversation. Never post anything to GitHub without first showing the review and getting explicit confirmation of exactly what would be posted and where; when posting is confirmed, prefer inline comments anchored at each finding's `file:line`.

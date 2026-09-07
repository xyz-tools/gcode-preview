---
name: review-gauntlet
description: Runs the full review battery — resolves the review target, selects the relevant focused review skills for the changed files, and merges their findings into one severity-ranked report. Use when a branch/PR is ready for a thorough pre-merge review.
---

# Review Gauntlet

Umbrella review: apply every *relevant* focused review skill to the current changes and merge the results. Each focused skill hunts one class of defect that has shipped real bugs in this repo.

**Read `.claude/skills/review-checklist/SKILL.md` first** — it holds the class roster, target resolution, empirical verification, severity tags, the finding format, the report structure, and the confirm-before-posting protocol. This skill adds only class selection and execution.

## Selecting relevant classes
Take the roster from the checklist skill and map the changed files to it; when in doubt, include:

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

## Merging
One report, per the checklist's format and structure: deduplicate so a line flagged by two classes is a single finding tagged with both, rank across all classes rather than within each, and fill the **Classes run vs skipped** table with every class you considered — including the ones you ruled out and why.

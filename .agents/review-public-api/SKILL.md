---
name: review-public-api
description: Reviews changes for public API surface discipline (new exports need rationale, no accidental internals, deprecated aliases on renames, v2.x contracts). Use when reviewing changes touching exports, index.ts, class member visibility, or the GCodePreview/WebGLPreview options.
---

# Public API Surface Review

Focused code review of the current changes for ONE class of defect: unjustified or accidental growth/breakage of the public API surface. Report findings only for this class — no general style feedback. Maintainer's literal words: "the public api is expanded and this is never taken lightly. Please add your rationale."

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks.

## What to hunt
- List EVERY newly public/exported symbol in the diff: new `export`s (index.ts and per-file), class members that gained `public` (or lost `private`/`#`), new options on the preview constructor, new exported types. Each one needs an explicit rationale — if the PR body doesn't give one, that is a finding.
- Accidental exposure of internals: scene groups, init methods (`initScene`-style), managers (ObjectsManager, SceneManager), parser/interpreter internals, or state objects reachable through a public field. Internals stay private until there's a deliberate decision.
- Renames of public symbols: project policy (see PR #441, `animate()`) requires keeping the old name as an `@deprecated` alias that delegates to the new one — a straight rename is a breaking change and a finding.
- Removals or signature changes of anything public — flag as breaking; propose deprecation instead.
- v2.x behavior contracts honored in 3.x: `buildVolume` is optional (constructing without one must not throw — #455); other options accepted in v2.8 must keep working or the change must be called out as intentional and documented.
- Exported-type renames break consumers just like function renames — same alias rule.

## Known incidents in this repo
- PR #136: internal members (`initScene`, scene groups, state) accidentally exposed as public API — "exposing it was an accident" — three separate flags on one PR; kept private.
- PR #455: 3.x regression against the v2.8 contract — constructing without `buildVolume` threw from SceneManager's unguarded `controls.target` setup; approximate-centering fallback restored.
- PR #441: `animate()` rename kept the old method as an `@deprecated` alias — the template for all future public renames.

## Detection heuristics
- `git diff origin/develop... -- src/ | grep -E '^\+.*export '` — every hit is a new or changed export to justify.
- Grep the diff for removed `private ` / `#` prefixes and added `public ` on class members.
- Diff the barrel file (index.ts / main entry) specifically — that is the real public surface.
- Grep for renamed symbols: an identifier deleted on one line and a similar one added — check for a `@deprecated` alias.
- Grep changed code for unguarded access to optional public config (`buildVolume`, callbacks, colors) — optional-by-contract means every access needs a guard.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "consumer on v2.8 constructs without buildVolume → throws at init").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

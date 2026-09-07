# Public API Surface Review

Defect class: unjustified or accidental growth/breakage of the public API surface. Maintainer's literal words: "the public api is expanded and this is never taken lightly. Please add your rationale."

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

**Example finding:** "consumer on v2.8 constructs without buildVolume → throws at init"

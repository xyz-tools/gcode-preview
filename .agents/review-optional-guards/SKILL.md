---
name: review-optional-guards
description: Reviews changes for unguarded access on optional public config (buildVolume, extrusionColor arrays, devgui state). Use when reviewing changes touching GCodePreview options, SceneManager, BuildVolume, DevGUI, or tool/color lookups.
---

# Optional-Config Guard Review

Focused code review of the current changes for ONE class of defect: member access on values the public API allows to be undefined or absent. This class has crashed the whole library repeatedly. Report findings only for this class — no general style feedback.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks.

## What to hunt
- `buildVolume` is optional in the public constructor options and can also be unset/cleared at runtime. Any `this.buildVolume.x`, `_buildVolume.*`, camera/`controls.target` centering math, or LineBox construction from it needs an undefined guard *and* a sensible fallback (approximate centering, not a throw — v2.8 contract, restored in #455).
- Arrays indexed by tool number: `extrusionColor[toolIndex]` where a file uses T1/T2/... beyond the provided colors — must fall back (repo convention: last color + warn once, #371). Same for any per-tool arrays (`toolColors`, materials, paths).
- DevGUI reading preview state that may be un-homed/undefined: position axes can be `undefined` before homing (#405); lil-gui `.add()` returns `undefined` for unsupported values, so chained `.listen()`/`.onChange()` throws. Wrap or present as NaN.
- `JSON.parse` / localStorage reads without try/catch — corrupted `dev-gui-open` aborted preview init (#413).
- BuildVolume never-throw policy (#300/#301/#403): validation must clamp, not throw; check both setters *and* the constructor path (the constructor bypassed setter validation in #403).
- Optional callbacks/options (`onProgress`, `canvas`, `initialCameraPosition`, preset fields) invoked or dereferenced without `?.` or an existence check.
- New public options added as `foo?: X` whose consumers assume presence — trace every consumer of a newly-optional field.

## Known incidents in this repo
- PR #297 → #299: Copilot flagged `controls.target` set from `this._buildVolume` without a null check; the exact crash shipped anyway as issue #298 and was guarded in #299.
- PR #455: 3.x regression — constructing without `buildVolume` threw from SceneManager's unguarded `controls.target` setup; v2.8 allowed it, fallback centering restored.
- PR #190: dev GUI crashed with no build volume; the "disable build volume" checkbox was a no-op.
- PR #371: `Cannot read properties of undefined (reading 'getHex')` when tool index exceeded the `extrusionColor` array.
- PR #405: DevGUI crash on un-homed (`undefined`) positions took down the whole preview.

## Detection heuristics
- Grep the diff for `buildVolume.` and `_buildVolume.` without a preceding `if (` guard or `?.`.
- Grep for `[tool` / `[t]` / `[index]` array indexing on color/material arrays without a bounds check or `??` fallback.
- Grep for `JSON.parse(` outside try/catch, and `localStorage.getItem` piped straight into parse.
- Grep for `.add(` chained to `.listen()`/`.onChange(` in dev-gui.ts.
- Check `gcode-preview.ts` option types: for every `?:` field, grep its consumers for unguarded access.
- Grep for `throw` in build-volume.ts — violates the clamp-don't-throw policy.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "new GCodePreview({}) with no buildVolume → TypeError in SceneManager → blank canvas").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

---
name: review-demo-impact
description: Reviews changes for options, controls, and presets that are silently turned into no-ops — accepted by the API but read by nothing, or overridden by a new value source. Use when reviewing changes to option resolution, defaults, precedence, or anything the demo/dev-gui drives.
---

# Demo & Option Impact Review

Focused code review of the current changes for ONE class of defect: a public option, demo control, or preset value that still *looks* wired but no longer does anything. Report findings only for this class — no general style feedback.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks.

## What to hunt
- **Demoted options.** An option that used to win now loses — e.g. changed from override to fallback behind a per-path/per-layer value, so it is never consulted on real files. Trace every changed default or precedence chain to the value that actually reaches the geometry.
- **Orphaned options.** An option still accepted by the public API (and still in `demo/js/default-settings.js` / `presets.js`) whose only reader was deleted or refactored away — accepted, documented, no effect.
- **Dead controls.** `demo/index.html` inputs bound through the `watchEffect` block in `demo/js/app.js` that writes `preview.sceneManager.*` from `settings.value.*`: if the assigned property stopped being read, the control is now decorative.
- **Stale presets.** Per-preset `extrusionWidth`, `lineHeight`, `colors`, `travelColor`, `buildVolume` in `demo/js/presets.js` that the new code path ignores — and preset *switching* assumptions (camera target, `clear()`, GUI re-injection) when the preview is no longer recreated per preset.
- **Missing re-render.** A property that changes state but no longer triggers a render, so the control appears broken until the user nudges the camera.
- **Dev GUI drift.** `src/dev-gui.ts` entries pointing at renamed/removed/now-optional fields — `lil-gui`'s `add()` returns `undefined` for an `undefined` value and chained calls then throw.
- **Demo build/run breakage.** Changes to exports, package fields, or imports that break `bin/dev` or the bundled demo even though `src/` tests stay green.

## Known incidents in this repo
- PR #394/#395: `topLayerColor`, `lastSegmentColor`, and `disableGradient` stayed in the public API but were read by no render path after the layer→toolPath refactor — silent no-ops that shipped.
- PR #192: the tube-width control stayed active while tube rendering was disabled, implying an effect it did not have.
- PR #190: the demo's "disable build volume" checkbox had no effect at all.
- PR #457: after the demo stopped recreating `GCodePreview` per preset, the Mach3 preset rendered a blank canvas — the controls target kept the construction-time plate center.
- PR #404: `loadGCodeFromServer` never called `preview.clear()`, so re-loading stacked a second copy of the model.
- PR #286: a re-added `lineHeight` default sat where it overrode job/layer-calculated heights.
- PR #101: the demo sidebar never refreshed on a new file drop.

## Detection heuristics
- For every option touched by the diff, grep the whole tree for its readers: `grep -rn '<optionName>' src/ demo/` — if the only hits are the declaration, the docs, and `default-settings.js`/`presets.js`, it is dead.
- Diff the precedence chain: search the changed files for `??` chains and pick which source wins; confirm against a real fixture in `demo/gcodes/` (e.g. `grep -c '^;WIDTH:' demo/gcodes/3DBenchy.gcode` — if slicer values are present in every bundled file, a demoted global option is dead in the demo).
- Cross-check `demo/index.html` control ids against the `watchEffect` assignments in `demo/js/app.js`, and those against readers in `src/`.
- Check `demo/js/presets.js` keys against the properties the new code path actually consumes.
- For renamed/removed/now-optional fields, grep `src/dev-gui.ts` for the old name.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "every bundled demo file emits `;WIDTH:` → the extrusion-width slider does nothing in tube mode").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

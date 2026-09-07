---
name: review-falsy-zero
description: Reviews changes for falsy-zero bugs (`x || fallback` / truthy checks on values where 0 is legitimate). Use when reviewing changes touching the parser, interpreter, state, coordinates, extrusion, indices, or counts.
---

# Falsy-Zero Review

Focused code review of the current changes for ONE class of defect: `x || fallback` or truthy `if (x)` on values where `0` is a legitimate value. Report findings only for this class — no general style feedback. This is the #1 shipped-bug source in this repo.

**Before reporting, read `.claude/skills/review-checklist/SKILL.md`** — it defines target resolution, empirical verification, severity tags, the Problem/Example/Recommendation format, and the confirm-before-posting protocol.

## What to hunt
- `|| fallback` on coordinates X/Y/Z, extrusion E, arc offsets I/J/K/R, feedrate F — `Z0`, `E0`, `X0` are all valid G-code. Must be `??` or explicit `!== undefined`.
- Truthy `if (x)` / `x ? a : b` on the same values, and on indices, counts, layer numbers, tool numbers (T0 is the default tool), `lineCount`, buffer offsets.
- Interpreter move handlers (`g0`/`g1`/`g2`/`g3` in the interpreter) computing deltas like `(z || state.z) - state.z` — the `||` silently drops a legitimate 0 target.
- Extrusion checks: `if (e)` treats retraction (negative E) and E0 the same as "no extrusion"; deposited-vs-travel must be `e > 0`, not truthiness.
- State merges in the parser/interpreter/Job where `undefined` means "not specified" but `0` means "move here" — conflating them via `||` or truthiness.
- Layer/clipping logic where layer 0 or `startLayer === 0` gets treated as unset.

## Known incidents in this repo
- PR #86: `if (next.z)` garbled the whole preview whenever a command had Z=0.
- PR #211 (caught in review): `state.x = x || state.x` ignored legitimate 0 coordinates; fixed with `??`.
- PR #370: `z || state.z` in `Interpreter.g2` ignored a legitimate `Z0` (shipped since #211); fixed to `(z ?? state.z) - state.z`.
- PR #392: `g2`/`g3` used truthy `e` instead of `e > 0`, so retracting arcs rendered as deposited filament and stretched the bounding box.

## Detection heuristics
- Grep the diff for `|| ` adjacent to `x`, `y`, `z`, `e`, `i`, `j`, `state.`, `layer`, `index`, `count`, `width`, `height`.
- Grep for `if (` followed by a bare parameter/property that is numeric (`if (next.z)`, `if (e)`, `if (params.x)`).
- Any ternary whose condition is a bare numeric value: `z ? ... : ...`.
- New defaulting in destructuring or function params (`= 0` vs `||`) — check which semantic is intended.
- Compare against nearby code that already uses `??` — mixed `||`/`??` in the same handler is a strong smell.

**Example finding:** "G1 Z0 → previous Z retained → garbled preview"

---
name: review-behavior-changes
description: Reviews changes for undisclosed behavior changes — same input, different output — and missing rationale/doc updates. Use when reviewing any change to parser, interpreter, rendering, or public API semantics before the PR body is finalized.
---

# Behavior-Change Disclosure Review

Focused code review of the current changes for ONE class of defect: output changes for the same input that are not explicitly called out, and design choices without stated rationale. Maintainer rule (PR #345): "Every change, intended or not, must be documented and visible." Report findings only for this class — no general style feedback.

## Scope
Resolve the target and obtain the code per section 1 of `.claude/skills/review-checklist/SKILL.md` — the work may be a local branch with no PR yet, an open PR, or uncommitted changes; never mutate the working tree to review. Read enough surrounding code of each changed file to judge correctness, not just the hunks. Also read the PR body / commit messages if available (`gh pr view`) to compare claims against the actual diff.

## What to hunt
- Any change that alters what a given G-code file renders as: vertex positions, layer boundaries, colors, clipping, arc tessellation, travel-vs-extrusion classification, bounding box, stats (`lineCount`, layer counts). If the same input now produces different output, the PR body must say so — intended *or* incidental.
- Side-effect changes smuggled into refactors: default values changed (State init, `lineHeight`, tessellation segment counts), condition flips (`||`→`??`, `>`→`>=`), reordered operations. Each is a behavior change even if "just cleanup".
- Design choices without rationale: new options, chosen defaults, algorithm picks. Rationale tables were literally demanded on #342 — for non-obvious choices, expect a stated alternative-vs-chosen justification, not just the outcome.
- Docs/tsdoc drift: changed behavior with stale `@param`/`@returns`/README/wiki text still describing the old semantics. Grep the tsdoc of every changed public method.
- PR-body claims contradicted by the diff (claims "no behavior change" but defaults moved; claims a copy removed when it isn't — see #349's pattern).
- Deprecations/removals: any change in what a documented option does (`disableGradient`, `topLayerColor`, `buildVolume` absence semantics) needs explicit disclosure — silent no-ops of accepted options shipped before (#394/#395 history).

## Known incidents in this repo
- PR #345: undocumented arc behavior change flagged by the maintainer — "Every change, intended or not, must be documented and visible"; also a State-init change (defaults → `undefined`) rolled back in-PR after review caught its behavioral fallout.
- PR #342: rationale tables were explicitly demanded for design choices before the maintainer would evaluate them.

## Detection heuristics
- Diff any changed default value, initializer, or literal constant against develop — each one is a candidate disclosure item.
- Grep the diff for changed comparison operators and `||`/`??` swaps in parser/interpreter/rendering code.
- List changed public methods, then check their tsdoc blocks and `docs/` / README for stale descriptions.
- Compare the PR body's "changes" list against `git diff --stat origin/develop...` — files changed but not mentioned are undisclosed-change candidates.
- Test-file diffs where *expected values* changed (not just new tests) are hard evidence of a behavior change — verify it's disclosed.

## Report format
Follow the shared standard in `.claude/skills/review-checklist/SKILL.md`. Each finding carries a severity tag — **[critical]** (crash/data loss), **[major]** (wrong output, silent no-op, broken contract), **[minor]** (perf, slow leak), or **[process]** (tests, disclosure, docs) — and three short parts:
- **Problem** — `file:line`, one sentence naming the defect.
- **Example** — concrete failure: input → wrong behavior, with a measured number where you have one (e.g. "same benchy.gcode → arc tessellation default changed → preview silently differs, PR body claims no behavior change").
- **Recommendation** — the specific fix, one sentence or a short code suggestion.

Rank by severity. Put real-but-currently-masked defects under **Latent**, and genuine bugs this change did not introduce under **Out of scope / pre-existing**, per the standard. Verify empirically where cheap — a measured number beats a reasoned claim. If nothing is found, say so in one line — no speculative findings. Output the review as your response first; never post to GitHub without explicit user confirmation, and prefer inline comments when it is granted.

## Problem

<!--
What was broken, from the user's point of view. Symptoms, not code.
Link the issue this fixes ("Fixes #123"), plus any related reports or PRs
("Ref #123") — duplicates, earlier attempts, the change that regressed it.
A gcode snippet or screenshot that reproduces it goes a long way.
-->

## Cause

<!--
The actual root cause. Why did it only show up in this situation, and why did
everything else survive? If it's a regression, name the change that introduced it.
-->

## Fix

<!--
What changed, and why here rather than somewhere else — especially if the
obvious-looking fix site was the wrong one.
-->

## Behavior changes

<!--
Bug fixes alter output by definition. Spell out what now renders/parses
differently for files that already worked, so it isn't buried in the diff.
-->

## Public API changes

<!-- New, changed, removed or deprecated exports, options, methods or types. Usually "None". -->

## Before / After

| Before | After |
| ------ | ----- |
|        |       |

## Checks

- [ ] `npm run check` passes (test + typeCheck + lint)
- [ ] `npm run test:coverage` — `src/` still at 100%
- [ ] Labelled `bug` + the relevant area label

Assisted by <tool> - <model>

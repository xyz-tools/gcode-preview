## Summary

<!--
What got faster or lighter, and for which workload.

Link the related issues and PRs ("Ref #123") — the tracking issue, the profiling
report, and any earlier PR in the same perf stack this builds on.
-->

## What was slow, and why

<!-- The bottleneck, with evidence — profile, flame graph, allocation counts. -->

## The optimization

<!-- What changed, and why it's safe. Note any accuracy/memory trade-offs taken deliberately. -->

## Numbers

| Metric | Before | After | Δ |
|---|---|---|---|
| Parse time |  |  |  |
| Render/build time |  |  |  |
| Peak memory |  |  |  |

<!-- Compare against the `develop` baseline, not against an earlier PR in the stack. -->

## How measured

<!--
File(s) used and their size, machine, browser/node version, number of runs, and
whether the numbers are medians. Point at the harness so someone else can rerun it.
-->

## Behavior changes

<!--
A perf PR should render identically. State that explicitly, and say how you
confirmed it — pixel comparison, geometry/vertex counts, existing suite.
If output does change, describe exactly how.
-->

## Public API changes

<!-- New or changed options/methods. Renames keep a @deprecated alias. Usually "None". -->

## Screenshots

<!-- Before/after render of the same file, to show output is unchanged. -->

## Checks

- [ ] `npm run check` passes (test + typeCheck + lint)
- [ ] `npm run test:coverage` — `src/` still at 100%
- [ ] Labelled `performance` + the relevant area label

Assisted by <tool> - <model>

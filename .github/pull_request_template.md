## Summary

<!--
What changes, and why.

Link the issue this closes ("Fixes #123"), and mention any related issues or PRs
("Ref #123", "stacked on #123", "supersedes #123") so the context is one click away.

Don't list the changes — the diff shows those. Explain the reasoning instead.
See "Writing a good PR description" in CONTRIBUTING.md.
-->

## Behavior changes

<!--
Anything that renders, parses or outputs differently for gcode that already
worked before — including side effects of a bug fix. "None" is a valid answer,
but say it explicitly rather than leaving this blank.
-->

## Public API changes

<!--
New, changed, removed or deprecated exports, options, methods or types.
Renames must keep the old name as a @deprecated alias. "None" is fine.
-->

## Screenshots

<!--
Required for anything with a visible effect. Before/after side by side helps:

| Before | After |
| ------ | ----- |
|        |       |
-->

## Checks

- [ ] `npm run check` passes (test + typeCheck + lint)
- [ ] `npm run test:coverage` — `src/` still at 100%
- [ ] Labelled appropriately (`bug` / `feature` / `meta` / area labels)

<!-- CONTRIBUTING.md requires disclosing AI tool usage. Keep or edit this line: -->
Assisted by <tool> - <model>

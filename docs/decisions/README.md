# Decisions

One short file per decision, readable in a minute. What belongs here is
decided in [0000](0000-record-decisions.md). Debates stay in issues and PRs;
only the outcome lands here.

## Format

```markdown
# Short title of the decision

**What:** The decision, stated as a rule.

**Why:** The argument that settled it. Usually just one.

**Impact:** What this causes, including what we give up. If it costs
something, add a brief reason. No need to prove anything.
```

Add a line like `See #123` if there's a discussion worth pointing to.

## Changing a decision

Don't rewrite an old record. Write a new one with `_Replaces: 0003-…_` under
the title, and add `_Replaced by: 0007-…_` to the old one. Only use these
lines when they apply.

## Naming

`NNNN-short-slug.md`, numbered in order, e.g.
`0001-drop-node10-module-resolution.md`.

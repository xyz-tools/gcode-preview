# Record decisions with hard impact

**What:** Decisions with hard impact get a short record in `docs/decisions/`.
Hard impact means the decision rules something out or sets a direction that's
costly to reverse: architecture, public API shape, dropping support for
something. These decisions are typically made by the maintainers.

**Why:** The outcome of a decision gets lost in issue and PR threads, so
contributors and AI agents end up undoing it by accident.

**Impact:** Soft impact, where users only need a workaround or a config
tweak, gets a README or release note instead: consumers hitting the
`@types/three` / `@webgpu/types` clash on TypeScript 6 got a README note, not
a record.

**When:** A record lands in the same PR as the change when one PR settles it.
When the decision comes first and the code follows over several PRs, write the
record first and say under **Impact** what isn't applied yet and which issue
tracks it. Records carry no status field: a record means settled, and the gap
between a settled decision and the code is tracked where the rest of the work
is tracked.

**Changing one:** Amend, don't rewrite. A new record replaces the old one, so
both the old reasoning and the change to it stay readable in `git log` instead
of being flattened into the current wording. The
[README](README.md#changing-a-decision) has the two lines that link them.

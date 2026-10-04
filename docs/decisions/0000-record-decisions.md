# Record decisions with hard impact

**What:** Decisions with hard impact get a short record in `docs/decisions/`.
Hard impact means the decision rules something out or sets a direction that's
costly to reverse: architecture, public API shape, dropping support for
something. These decisions are typically made by the maintainers.

**Why:** The outcome of a decision gets lost in issue and PR threads, so
contributors and AI agents end up undoing it by accident.

**Impact:** Hard-impact changes need a record in the same PR. Soft impact,
where users only need a workaround or a config tweak, gets a README or release
note instead: TypeScript 5.x consumers needing `@webgpu/types` got a README
note, while dropping node10 module resolution got
[a record](0001-drop-node10-module-resolution.md).

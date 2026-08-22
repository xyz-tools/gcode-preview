---
name: bump-three-version
description: Bump the maximum supported three.js version when a new release comes out. Checks the three.js changelog/migration guide for breaking changes first, updates every file that references the supported version range, and only opens a PR once all tests pass locally against the new version.
---

# Bump the max supported three.js version

Use this when a new `three` release comes out and we want to widen the range of
versions `gcode-preview` supports up to (and including) that new release.

`three` is a **peer dependency** here — we support a *range* of versions, not a
single pinned one. "Bumping the max version" means raising the upper bound of
that supported range and adding the new version to the CI test matrix.

## Step 1 — Check for breaking changes (do this FIRST)

> ⚠️ **three.js does NOT follow semver.** The version number tells you nothing
> about whether a release is safe. A `0.0.x`-looking bump (e.g. `0.185` → `0.186`)
> can and regularly does ship breaking changes. **Never assume a release is
> non-breaking because of the number** — always read the changelog and migration
> guide for *every* release, no matter how small the version increment looks.

Before touching any file, find out whether the new release breaks anything.
three.js posts its changelog in two places:

- **GitHub Releases** (per-version release notes):
  https://github.com/mrdoob/three.js/releases
- **Migration Guide** (the canonical list of breaking changes, one section per
  version — read every section between our current max and the new version):
  https://github.com/mrdoob/three.js/wiki/Migration-Guide

Read the notes for **every** version between our current upper bound and the new
one (e.g. if we support up to `0.185` and `0.187` just shipped, read `0.186`
**and** `0.187`). Pay attention to renamed/removed APIs, changed defaults, and
anything touching the classes we use (geometry, materials, `BufferGeometry`,
`Vector3`, WebGL/WebGPU renderers, etc.).

### If there ARE breaking changes

**Stop and ask the user** which of these they want:

1. **Fix the breaking changes now** as part of this bump, or
2. **Open a GitHub issue** describing the breaking changes and **abort the bump
   entirely** (revert any edits, don't open a PR).

Do not proceed on your own — wait for their choice. If they pick the issue,
create it with `gh issue create`, summarise the breaking changes and the version
that introduced them, then stop.

### If there are NO breaking changes

Continue to Step 2.

## Step 2 — Update every file that references the version

Search for the old bound first so nothing is missed (include `.ts` — one of
the files below is a test that hardcodes the range):

```bash
grep -rn "0\.1[0-9][0-9]" --include="*.json" --include="*.yml" --include="*.ts" \
  . --exclude-dir=node_modules --exclude-dir=.git
```

Files that need updating (as of this writing):

1. **`package.json`** — the supported range in `dependencies`:
   ```json
   "three": ">=0.166.0 <0.186.0"
   ```
   Raise the upper bound so the new version is included. The bound is
   **exclusive**, so for new version `0.186.x` set it to `<0.187.0`.

2. **`package.json`** — the `@types/three` devDependency:
   ```json
   "@types/three": "^0.185.4"
   ```
   Bump to the `@types/three` release that matches the new `three` version.

3. **`.github/workflows/run-tests.yml`** — the test matrix under
   `strategy.matrix.include`. Add a new entry pairing the new `three-version`
   with its matching `types-version`:
   ```yaml
   - three-version: 0.186.0
     types-version: 0.186.0
   ```
   Use the exact latest patch of each (e.g. `three@0.179.1`, `@types/three@0.178.1`) —
   check npm for the precise numbers. Keep the existing older rows; this matrix
   tests the whole supported range, min to max.

4. **`src/__tests__/three-version.ts`** — this test asserts that
   `package.json`'s `three` range **exactly equals** the range computed from its
   own constants, so it must move in lockstep. Update `MAX_EXCLUSIVE_VERSION`
   (and `MIN_VERSION` if raising the floor) to match the new bound, e.g.:
   ```ts
   const MAX_EXCLUSIVE_VERSION = '0.187.0';
   ```
   If this file and `package.json` disagree, `npm run test` fails.

5. **`package-lock.json`** — regenerated automatically. Run `npm install` after
   editing `package.json` and commit the resulting lockfile change.

6. **Demo bundle** (`demo/lib/three/build/*.min.js`) — copied from
   `node_modules` by `npm run copy-deps` at deploy time, so there's no version
   literal to edit. Just make sure the installed `three` is the new version
   before a deploy; nothing to change in this PR.

Always re-run the `grep` above after editing to confirm no stray references to
the old bound remain.

## Step 3 — Install the new version and verify locally

Install the new versions and run the full check suite. **All tests must pass
locally before opening a PR** — this mirrors what CI runs:

```bash
npm install three@<new-version> @types/three@<new-types-version>
npm run check
```

`npm run check` runs `test`, `typeCheck`, and `lint`. If anything fails, fix it
(or, if it's an unforeseen breaking change, go back to Step 1's decision point
with the user). Do not open the PR until `check` is green.

## Step 4 — Open the PR

Only once local checks pass. Create a branch, commit, and open the PR against
`develop`. Use this description template:

```markdown
## Bump max supported three.js to <new-version>

three.js <new-version> was released and this raises our supported range to
include it.

- Upper bound in `package.json` raised to `<0.<next>.0`
- `@types/three` bumped to `^<new-types-version>`
- Added `<new-version>` to the CI test matrix in `run-tests.yml`
- Regenerated `package-lock.json`

**Breaking changes:** none (checked the [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
and [release notes](https://github.com/mrdoob/three.js/releases)).

All checks pass locally (`npm run check`).

Assisted by Claude Code - <model>
```

Follow the repo's PR conventions: no `perf:`/`POC:` prefix in the title, use
GitHub labels instead, and end the body with the
`Assisted by Claude Code - <model>` attribution line.

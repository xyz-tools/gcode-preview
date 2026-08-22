---
name: release-and-publish
description: Cut a new gcode-preview release and publish it to npm. Covers the version bump, demo deploy, GitHub Release creation, and the automatic npm-publish + Discord announcement. Includes a template for the release notes (the text shown on the GitHub Releases page, which is also broadcast to Discord).
---

# Cut a release and publish to npm

Use this to ship a new version of `gcode-preview`. Nothing is published by
running `npm publish` by hand — publishing is triggered by **creating a GitHub
Release**, and the release notes you write are **automatically broadcast to
Discord (`@everyone`)**, so write them carefully.

## How publishing is wired (read this before releasing)

- `.github/workflows/npm-publish.yml` runs on `release: [released]` → builds,
  tests, and runs `npm publish` to npmjs.
- `.github/workflows/announce-release-in-discord.yml` also runs on
  `release: [released]` → posts the release body to Discord.
- `.github/workflows/firebase-hosting-merge.yml` runs on **push to `develop`** →
  deploys the demo to https://gcode-preview.web.app (`predeploy` + `typedoc`).

> ⚠️ **The `released` event only fires for a normal (non-prerelease) Release.**
> If you tick "Set as a pre-release", GitHub fires `prereleased` instead, so
> **npm-publish will NOT run**. Stable releases must be published as a normal
> release. Alpha/prerelease builds go through a different path (see below).

### Alpha / prerelease channel

Alpha builds are published by pushing to the **`alpha` branch**, which triggers
`.github/workflows/npm-publish-alpha.yml` → `npm publish --tag alpha`. Do **not**
try to publish an alpha via a GitHub Release — use the branch.

## Step 1 — Bump the version

From `develop`, run one of:

```bash
npm run version:minor   # or version:patch
```

This runs the `preversion` gate first (`typeCheck` + `test:coverage` + `lint`) —
if any of those fail, fix them before continuing. On success it bumps the
`version` in `package.json`, commits, and creates a matching git tag (e.g.
`v3.1.0`).

There is no `version:major` script; for a major bump run `npm version major`
directly (still runs `preversion`).

## Step 2 — Push and verify the demo

```bash
git push                 # pushes the version-bump commit on develop
git push --tags          # pushes the new tag (plain `git push` does NOT)
```

Pushing `develop` auto-deploys the demo. **Verify https://gcode-preview.web.app
actually works** before creating the release — the deploy is the last thing that
catches a broken build in a real browser.

## Step 3 — Draft the release notes

Generate a first draft of the changelog, then curate it (see the template
below):

```bash
gh release create <tag> --generate-notes --draft --verify-tag
```

`--generate-notes` groups merged PRs since the previous tag. Rework that draft
into the themed sections in the template — do not ship the raw auto-notes; the
recent releases use curated, human-readable sections.

## Step 4 — Publish the release

Once the notes are ready, publish it as a **normal release** (this is what fires
npm-publish + Discord):

```bash
gh release edit <tag> --draft=false --latest
# or, if creating fresh:
gh release create <tag> --title "<title>" --notes-file <notes.md> --latest --verify-tag
```

Do NOT pass `--prerelease` for a stable release (see the warning above).

After publishing, confirm:
- The **Node.js Package** workflow (npm-publish) went green and the new version
  is live on https://www.npmjs.com/package/gcode-preview.
- The Discord announcement posted.

## Release notes template

The title and body appear on the [Releases page](https://github.com/xyz-tools/gcode-preview/releases)
and are what Discord broadcasts. Keep the body user-facing — these are read by
people deciding whether to upgrade, not just contributors.

**Title:** `v<version>` optionally with a short theme, e.g.
`v2.18.0 - Summer Time` or `v3.1.0 🚀 Faster tubes 🚀`.

**Body:**

```markdown
## <version> <optional emoji theme>

<1–3 sentence summary of what this release is about and who should care.>

### 🚀 New Features
* **<Feature name>:** <what it does, in plain language> (#<PR>)

### 🛠️ Improvements
* **<Area>:** <what changed and why it's better> (#<PR>)

### 🐛 Bug Fixes
* <what was broken, now fixed> (#<PR>)

### 📝 Docs & Types
* <doc/typing change> (#<PR>)

### ⬆️ Dependency Updates
* Bumped `three` to r<NNN>
* Bumped `<dep>` to <version>

**Full Changelog**: https://github.com/xyz-tools/gcode-preview/compare/<prev-tag>...<tag>
```

Notes on the template:
- Drop any section that has no entries — not every release has all five.
- Attribute meaningful contributions (`by @user`) the way the auto-generated
  notes do, especially first-time and external contributors.
- Always keep the **Full Changelog** compare link at the bottom; `gh release
  create --generate-notes` adds it automatically — reuse it.
- Because this hits Discord `@everyone`, proofread before publishing; edits after
  the fact won't re-notify but the stale version stays broadcast.

## Notes

- `PUBLISHING.md` is partially stale (it mentions merging into a `releases`
  branch and TODO example deploys). The workflows above are the source of truth:
  a `develop` push deploys the demo and a published GitHub Release publishes to
  npm. The `releases` branch step is not required by any current workflow.

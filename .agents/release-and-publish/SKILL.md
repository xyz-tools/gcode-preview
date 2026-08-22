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

There is **one path for every release**: publish a GitHub Release. Stable and
prerelease builds both go through it — the only difference is the version number.

- `.github/workflows/npm-publish.yml` runs on `release: [published]` → builds,
  tests, and runs `npm publish`. It derives the npm **dist-tag from the version
  in `package.json`**: a plain version (`3.1.0`) publishes to `latest`; a
  prerelease version (`3.1.0-alpha.1`) publishes to its prerelease id (`alpha`).
- `.github/workflows/announce-release-in-discord.yml` runs on
  `release: [released]` → posts the release body to Discord. Note this uses
  `released`, **not** `published`, so **only stable releases ping Discord
  `@everyone`** — prereleases publish to npm silently. That's intentional.
- `.github/workflows/firebase-hosting-merge.yml` runs on **push to `develop`** →
  deploys the demo to https://gcode-preview.web.app (`predeploy` + `typedoc`).

> 💡 **The version number is the single source of truth for the npm tag.** You
> never pass `--tag` by hand. Bump to a plain version for a stable release, or a
> `-alpha.N` version for an alpha, and the workflow does the rest. (There is no
> separate `alpha` branch anymore — everything ships through a GitHub Release.)

## Step 1 — Bump the version

From `develop`, run the script that matches the kind of release:

```bash
npm run version:minor   # stable minor  -> 3.1.0   -> npm tag: latest
npm run version:patch   # stable patch  -> 3.0.1   -> npm tag: latest
npm run version:alpha   # alpha bump    -> 3.1.0-alpha.1 / .2 / ... -> npm tag: alpha
```

Each runs the `preversion` gate first (`typeCheck` + `test:coverage` + `lint`) —
if any of those fail, fix them before continuing. On success it bumps the
`version` in `package.json`, commits, and creates a matching git tag (e.g.
`v3.1.0` or `v3.1.0-alpha.1`).

`version:alpha` runs `npm version prerelease --preid=alpha`: from a stable
version it starts a new `-alpha.0` line, and from an existing alpha it increments
the alpha counter. There is no `version:major` script; for a major bump run
`npm version major` directly (still runs `preversion`).

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

Once the notes are ready, publish it. Both kinds publish to npm; the flags only
affect how GitHub labels the release and whether Discord is notified:

```bash
# Stable release — marked latest, pings Discord @everyone:
gh release create <tag> --title "<title>" --notes-file <notes.md> --latest --verify-tag

# Alpha / prerelease — marked pre-release, does NOT ping Discord:
gh release create <tag> --title "<title>" --notes-file <notes.md> --prerelease --verify-tag
```

The npm dist-tag comes from the version number, not these flags — a
`-alpha.N` version always lands on the `alpha` tag even though the publish
happens via a GitHub Release. Mark alpha releases `--prerelease` so GitHub shows
them correctly and Discord stays quiet.

After publishing, confirm:
- The **Node.js Package** workflow (npm-publish) went green and the version is
  live on https://www.npmjs.com/package/gcode-preview under the expected tag
  (`npm view gcode-preview dist-tags`).
- For a stable release, the Discord announcement posted.

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

- The workflows above are the source of truth: a `develop` push deploys the
  demo, and a published GitHub Release publishes to npm (tag derived from the
  version). Neither a `releases` branch nor an `alpha` branch is involved — those
  older paths have been retired.

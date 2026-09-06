# Publishing a release

Everything ships through a **GitHub Release**. The npm dist-tag is derived from
the version number, so there is a single path for both stable and alpha builds.

## 1. Bump the version (on `develop`)

```bash
npm run version:minor   # stable minor       (npm tag: latest)
npm run version:patch   # stable patch       (npm tag: latest)
npm run version:alpha   # prerelease -alpha.N (npm tag: alpha)
```

The resulting number follows normal semver rules — note that from a prerelease
(e.g. `3.0.0-alpha.5`) both `minor` and `patch` resolve to `3.0.0`, not
`3.1.0`/`3.0.1`. There is no `version:major` script; run `npm version major`
directly (it still runs the `preversion` gate).

Each runs the `preversion` gate (`typeCheck` + `test:coverage` + `lint`), bumps
`package.json`, commits, and creates a git tag.

## 2. Push and check the demo

```bash
git push
git push --tags
```

Pushing `develop` auto-deploys the demo (and the typedoc API docs) to
https://gcode-preview.web.app — verify it works.

## 3. Draft the release notes

```bash
gh release create <tag> --generate-notes --draft --verify-tag
```

Curate the auto-generated notes into the themed sections from the template in
`.agents/release-and-publish/SKILL.md`. **A stable release broadcasts this body
to Discord `@everyone` — get sign-off on the title and full body before
publishing.**

## 4. Publish the GitHub Release

```bash
# Stable — marked latest, pings Discord:
gh release create <tag> --title "<title>" --notes-file <notes.md> --latest --verify-tag

# Alpha — marked pre-release, Discord stays quiet:
gh release create <tag> --title "<title>" --notes-file <notes.md> --prerelease --verify-tag
```

Publishing the release triggers `npm-publish.yml`, which builds, tests, and runs
`npm publish` with the dist-tag taken from the version (`latest` for a plain
version, `alpha`/`beta`/`rc` for a prerelease). Stable releases also announce to
Discord; prereleases publish silently.

## 5. Verify

- The **Node.js Package** workflow (`npm-publish.yml`) is green.
- `npm view gcode-preview dist-tags` shows the new version under the expected tag.
- For a stable release, the Discord announcement posted.

See `.agents/release-and-publish/SKILL.md` for the full walkthrough and the
release-notes template.

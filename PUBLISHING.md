# Publishing a release

Everything ships through a **GitHub Release**. The npm dist-tag is derived from
the version number, so there is a single path for both stable and alpha builds.

## 1. Bump the version (on `develop`)

```bash
npm run version:minor   # stable    -> 3.1.0          (npm tag: latest)
npm run version:patch   # stable    -> 3.0.1          (npm tag: latest)
npm run version:alpha   # prerelease -> 3.1.0-alpha.1 (npm tag: alpha)
```

Each runs the `preversion` gate (`typeCheck` + `test:coverage` + `lint`), bumps
`package.json`, commits, and creates a git tag.

## 2. Push and check the demo

```bash
git push
git push --tags
```

Pushing `develop` auto-deploys the demo to https://gcode-preview.web.app — verify
it works.

## 3. Create the GitHub Release

- Stable: publish the release from the tag, marked **latest**.
- Alpha: publish it marked **pre-release**.

Publishing the release triggers `npm-publish.yml`, which builds, tests, and runs
`npm publish` with the dist-tag taken from the version (`latest` for a plain
version, `alpha`/`beta`/`rc` for a prerelease). Stable releases also announce to
Discord; prereleases publish silently.

See `.agents/release-and-publish/SKILL.md` for the full walkthrough and the
release-notes template.

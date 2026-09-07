---
name: debugger-screenshots
description: Capture screenshots from the devtools Debugger for pull request descriptions — especially before/after proof that an implementation works, using custom/synthetic gcode pasted into the debugger (the pattern PR #439 uses). Covers driving the debugger reproducibly, capturing identical framings for both sides, publishing images on a throwaway assets branch, and the PR body layout.
---

# Debugger screenshots for PR descriptions

Use this when a PR needs **visual proof** that a change works — typically a
before/after pair rendered from the same gcode, where "after" is this branch
and "before" is the base branch or a published version. This shines when no
bundled demo file exercises the change: paste a small **synthetic gcode
snippet** into the Debugger and show what it renders. PR #439 is the
reference example (synthetic G38.2 probe scene, two-column table, assets on a
throwaway branch).

## 1 — Build and serve

```sh
npm run build   # produces dist/gcode-preview.es.js for the "local build" option
npx live-server demo --port=8123 --no-browser --watch=gcodes \
  --mount=/lib:node_modules --mount=/dist:dist --mount=/devtools:devtools
```

Run the server in the background and **always kill it when done**
(`pkill -f "live-server demo"`). The debugger lives at
`http://127.0.0.1:8123/devtools/debugger/`.

## 2 — Drive the debugger reproducibly

Open the page with whatever browser automation is available (chrome-devtools
MCP, Playwright, Puppeteer, …) — everything below is expressed as JavaScript
to run in the page context plus element ids, so any of them works. Before
anything else, make the run reproducible:

```js
localStorage.removeItem('gcode-preview-devtools:debugger'); // no restored session/breakpoints/settings
localStorage.setItem('gcode-preview-devtools:theme', 'dark'); // either theme works — just use the same one for both shots
```

Element ids you will script against: `version-select`, `preset-select`,
`gcode-text` (paste area — **wins over the preset when non-empty**),
`load-button`, `status`, `debug-readout`, `debug-step`, `debug-continue`,
`debug-run` (run to end), `debug-run-first` ("Run to first"), and `commands`
(the virtual list).

- Wait for `version-select` to have >1 option before loading (the version
  list is fetched from jsDelivr).
- Paste the synthetic gcode into `#gcode-text`, click Load, then poll
  `#status` until it contains "Loaded". Poll with a small async loop run in
  the page context (check the text, `await` a short timeout, repeat) rather
  than the automation tool's wait-for-text helper — the status text changes
  quickly and text matchers have missed it here.
- Between debug operations, wait until `#debug-step` is re-enabled.
- Drive to the state that demonstrates the change: "Run to end" for a full
  render, or breakpoints/stepping for a mid-print state. For paused states,
  note the command index and reuse **the exact same index** on both sides.
- **Never drag/orbit the preview.** The default camera is deterministic;
  touching it ruins before/after comparability.
- If visibility needs it (e.g. travel moves), use the Instantiation settings
  editor (Apply) — but apply the **same settings JSON on both sides**, and
  remember settings persist in localStorage (that's why step one clears it).

## 3 — Capture both sides identically

Keep the same browser window size, page scroll, split position, and theme for
both shots. For tight framing, take an element screenshot of the preview
panel if the automation tool supports one; otherwise a viewport screenshot
after `scrollIntoView` on the preview works, as long as both shots use
identical scroll. Save as PNG or WebP with descriptive names, e.g.
`pr<NUM>-<scene>-<side>.png`.

- **After** (this PR): `version-select` = "local build (this checkout)" with
  `dist/` built from this branch.
- **Before**, pick one:
  - The change regressed/landed relative to a **published release** → just
    select that version in `version-select`. No rebuild needed.
  - The base is an **unpublished branch** (stacked PRs): commit your work
    first, then `git checkout <base-branch> && npm run build`, capture the
    "before" shot (the server serves `/dist` live), then
    `git checkout - && npm run build` to restore. Never use bare `git stash`
    in this repo's worktrees.

Sanity check: if before and after are supposed to differ, confirm the two
images actually do (and if they're supposed to match, that they do) before
writing the PR body around them.

## 4 — Publish the images on a throwaway assets branch

PR screenshots are review material, not repo content — don't commit them to
the feature branch. Use an orphan assets branch (safe version that never
touches your working tree):

```sh
git worktree add --detach /tmp/pr<NUM>-assets
cd /tmp/pr<NUM>-assets
git checkout --orphan pr<NUM>-assets
git rm -rf --cached -q . && git clean -fdq
cp <your screenshots> .
git add *.png *.webp 2>/dev/null; git commit -m "PR #<NUM> screenshots"
git push origin pr<NUM>-assets
cd - && git worktree remove --force /tmp/pr<NUM>-assets
```

Reference them as
`https://raw.githubusercontent.com/xyz-tools/gcode-preview/pr<NUM>-assets/<file>.png`
and add a note in the PR that the branch is throwaway: "delete it after
merge". (Exception: images that are also permanent docs — like the
`devtools/screenshots/` set — belong on the feature branch, referenced by
commit-SHA-pinned raw URLs instead.)

## 5 — PR body layout

Follow PR #439's structure inside a `## Screenshots` section:

- State how the shots were captured: "identical viewports and scripted
  cameras, this branch vs <base/version>".
- Include the synthetic gcode in a fenced ` ```gcode ` block so reviewers can
  reproduce it (paste it into the debugger the same way).
- One or two sentences explaining what each side shows and why the difference
  proves the change.
- Side-by-side two-column table:

```markdown
| this PR (<what changed>) | base (<what it lacks>) |
|---|---|
| ![after](https://raw.githubusercontent.com/xyz-tools/gcode-preview/pr<NUM>-assets/after.png) | ![before](https://raw.githubusercontent.com/xyz-tools/gcode-preview/pr<NUM>-assets/before.png) |
```

## Gotchas

- **Chrome profile lock** (only if using the chrome-devtools MCP): a browser
  call failing with "browser is already running for
  …/chrome-devtools-mcp/chrome-profile" means the automation Chrome got
  orphaned — run `pkill -f chrome-profile`, wait 2s, retry once. That Chrome
  is the dedicated automation instance, never the user's browser.
- The preview canvas is intentionally **dark in both themes** — page theme
  never affects the rendered pixels.
- The debugger needs a 3.x build; 2.x versions in `version-select` degrade to
  a notice. For 2.x-vs-3.x comparisons use the visual-diff devtool instead
  (`/devtools/visual-diff/`), which pins the camera and diffs pixel-exactly.
- Custom gcode with no extrusion renders nothing unless `renderTravel` is on —
  set it via the Instantiation settings editor (both sides!).

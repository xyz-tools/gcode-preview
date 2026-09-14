# Dev tools

Internal tooling for gcode-preview development. Unlike `demo/`, nothing in here is
deployed — these pages exist to help develop and release the library itself.

## Running

Point any static server at this checkout and open `…/devtools/`. Both common
layouts work:

- **the repo root** (a VS Code live preview, `npx http-server .`) — the demo is
  then under `/demo/` and three/lil-gui under `/node_modules/`.
- **`demo/` as the root with mounts** — what `npm run dev` gives you
  (`--mount=/lib:node_modules --mount=/dist:dist`), except that it has no mount
  for this directory, so `/devtools/` is not reachable that way without editing
  the tracked `package.json`.

`lib/roots.js` probes for the demo assets and node_modules once at load and
resolves everything from its own URL, so no page hardcodes a layout. Every page
has a light/dark toggle top right; the choice persists across pages and reloads.

The pages reuse the demo's assets over the same server: `style.css`, the preset
catalog (`js/presets.js`), the bundled gcode files (`gcodes/…`), and the local
library build (`dist/gcode-preview.es.js` — produced by `npm run build`, or kept
fresh by `npm run dev`'s watcher).

## Shared infrastructure (`lib/`)

- `versions.js` — lists published versions from jsDelivr and builds a per-version
  import map (each release gets the three/lil-gui versions it was published
  against; `local` maps to `/dist`, and `commit:…` to a sweep build in
  `dist/` — both against this checkout's three/lil-gui).
- `runner-frame.js` — runs a tool's runner script in a sandboxed iframe with its
  own import map, with a small postMessage protocol
  (`ready`/`phase`/`progress`/`result`/`error`).
- `preview-compat.js` — version-agnostic construction: 3.x `GCodePreview`
  (scene bits under `.sceneManager`) vs 2.x `WebGLPreview` (flat).
- `demo-presets.js` — the demo's preset catalog, file URLs, and merged display
  settings.
- `history.js` — harvested benchmark runs in localStorage, grouped into
  comparable sets, with CSV/JSON download.
- `roots.js` — probes where the demo assets, node_modules and `dist/` are, so
  the pages work whatever the server's root is.

## Tools

### Debugger (`debugger/`)

![Debugger](screenshots/debugger.webp)

Load a preset or paste gcode and inspect the parse result: summary stats,
command-type histogram (both collapsed by default after loading), and a
filterable command list that virtual-scrolls through even 163k-command files
with no pagination (e.g. filter to only `G92`s). Full inspection targets 3.x builds (2.x doesn't export the parser).

The Commands section is a live debugger: click a row's gutter to set a
breakpoint, then step forward/back one command at a time, continue to the
next breakpoint, or jump straight past the slicer's metadata preamble with
"Run to first". A live preview renders the toolpath as you step, and a State
panel shows the interpreter's State object (position, positionShift, tool,
units, isHomed) with the keys that changed on the last step highlighted.
Stepping back re-executes from the start, which stays fast even on benchy
(163k commands re-execute in tens of milliseconds). The loaded file and
breakpoints persist across reloads via localStorage.

A collapsed "Instantiation settings" editor exposes the full options object
the library is constructed with: edit the JSON and Apply (the session rebuilds
with breakpoints and position preserved), pick a curated preset (lines, travel,
orthographic, high-contrast), or Reset to default. Edits persist across
reloads. The commands/panel split is resizable by dragging the separator
(double-click resets).

### Benchmark (`benchmark/`)

![Benchmark](screenshots/benchmark.webp)

Compares two versions of the library head-to-head on one of the demo gcode files,
for the release-gate benchmarks of issue #402: parse time, time to first render,
FPS while orbiting, and peak JS heap, plus geometry build time, triangles, and
draw calls.

Any published npm version (loaded from jsDelivr, with the three/lil-gui versions
that release was published against) can be compared against any other, or against
the local `dist/` build. Each version runs sequentially in a fresh sandboxed
iframe so runs cannot contaminate each other; runs are interleaved A/B and the
table reports medians. Results can be copied as CSV or Markdown.

Peak-heap numbers need Chrome (`performance.memory`); everything else works in
any browser.

#### Sweeping a range of commits

To see how a metric moved across a stretch of history — say every commit
between your checkout and the tip of `develop` — build them all first:

```
node devtools/sweep/build-commits.mjs            # HEAD → develop, mainline only
node devtools/sweep/build-commits.mjs --base v3.0.0-alpha.5 --tip develop
node devtools/sweep/build-commits.mjs --all-commits   # include merged-branch commits
```

Each commit is checked out in a detached worktree (`devtools/dist/.worktree`)
that borrows this checkout's `node_modules`, so **your working tree is never
touched** and three/lil-gui are identical for every build — the only thing that
varies is the library. Commits whose `src/` tree is unchanged reuse the previous
build instead of rebuilding. Output lands in `devtools/dist/` as
`<short-sha>.js` plus an `index.json` catalog the page reads; re-running skips
shas already built (`--force` to rebuild). It is called `dist` so that the bare
`dist` already in `.prettierignore` and `.eslintrc.js` keeps the build
artifacts out of `npm run lint` — no tracked config file has to change.

Back on the benchmark page, the Mode select then offers:

- **Compare A/B** — the original two-version, interleaved comparison.
- **Harvest one version** — measure version A alone and append it to the
  history table.
- **Sweep commit builds** — walk every build in the catalog, oldest first,
  appending each as it lands. "Skip already harvested" makes an interrupted
  sweep resumable, and Stop ends it after the current build.

Harvested runs collect in the **Harvested runs** table, grouped by what is
actually comparable (file + geometry + run count), one row per commit in commit
order, with each metric shown against the group's oldest row. The table lives in
localStorage, so it survives reloads, rebuilds and checkouts; **Download CSV** /
**Download JSON** save it to a file, and Copy Markdown is there for pasting into
an issue.

### Memory-leak tester (`memory-leak/`)

![Memory-leak tester](screenshots/memory-leak.webp)

Release-gate check: runs repeated create → load → render → dispose cycles
(fresh canvas each cycle, like a framework remount) and charts JS heap per
cycle plus the `renderer.info.memory` geometry/texture counts read *after*
`dispose()` — any nonzero residual means dispose leaked GPU resources. The
heap verdict compares median steady-state heap between window halves. Heap
numbers need Chrome.

### Streaming equivalence checker (`streaming-equivalence/`)

![Streaming equivalence checker](screenshots/streaming-equivalence.webp)

Loads the same file twice in one version — once as a whole string, once as a
ReadableStream chunked at a configurable size (small chunks maximize
command-split-across-chunks coverage) — and diffs parser/job stats plus a
rendered-triangles fingerprint. Any mismatch is a parser streaming bug.

### Visual diff (`visual-diff/`)

![Visual diff](screenshots/visual-diff.webp)

Renders the same file in two versions with a pinned camera/target, captures
both canvases, and pixel-diffs them (changed pixels highlighted, % reported,
adjustable threshold). Catches rendering regressions that timing numbers miss.

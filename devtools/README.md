# Dev tools

Internal tooling for gcode-preview development. Unlike `demo/`, nothing in here is
deployed — these pages exist to help develop and release the library itself.

## Running

The demo dev server also serves this directory:

```
npm run dev          # or: npm run demo
```

then open <http://localhost:8080/devtools/>.

The pages reuse the demo's assets over the same server: `/style.css`, the preset
catalog (`/js/presets.js`), the bundled gcode files (`/gcodes/…`), and the local
library build (`/dist/gcode-preview.es.js` — produced by `npm run build`, or kept
fresh by `npm run dev`'s watcher).

## Tools

### Benchmark (`benchmark/`)

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

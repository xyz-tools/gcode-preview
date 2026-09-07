# Lifecycle & Disposal Review

Defect class: resource lifecycle — missing disposal, unbounded disposable growth, initialization-order hazards, and constructors that throw.

## What to hunt
- Every `new` three.js resource (geometry, material, texture, BatchedMesh, LineBox), lil-gui/Stats panel, event listener, and rAF loop added in the diff must have a matching `dispose()`/`removeEventListener`/`cancelAnimationFrame` path reachable from the preview's `dispose()`.
- Nothing pushed into a `disposables` list from a method called repeatedly (render, clear, per-chunk, per-frame) — that's unbounded growth plus double-dispose on teardown. Push only from one-time init, or guard against re-push.
- `clear()`/re-init paths: do they orphan meshes still attached to the scene (leak per clear), and do stale references (old scene groups, old ObjectsManager entries, watched devgui objects) survive re-init?
- Constructor field order: reading `this.x` before it is assigned (options destructured after use, callbacks wired to a not-yet-created object). Watch for callbacks passed to sub-objects during construction that capture fields assigned later.
- Constructors and init must not throw: `JSON.parse` on localStorage, optional `buildVolume` access, and any user-config read need try/catch or guards — a throw aborts the entire preview init.
- Chained builder APIs (lil-gui `.add(...).listen()`) where an earlier call can return `undefined` for edge-case inputs (un-homed/undefined axes).

## Known incidents in this repo
- PR #110: no `dispose()` at all — rAF loop and three.js objects leaked per preview instance (SPA killer).
- PR #296: lil-gui and Stats panels never disposed, leaking DOM/resources across instances.
- PR #380: `initScene()` re-pushed the build volume into `disposables` every render (unbounded growth + double-dispose); `clear()` orphaned the bounding-box mesh (leak per clear).
- PR #412: constructor read `this.devMode` before assignment — `initStats()` unreachable, FPS meter never appeared.
- PR #413: bare `JSON.parse` of a corrupted `dev-gui-open` localStorage entry threw in the DevGUI constructor, aborting preview init.
- PR #405: devgui chained `.add(...).listen()` on lil-gui's `undefined` return for un-homed axes — crashed the whole preview.
- PR #309 (Copilot flag): `stats` initialized after the `Renderer` whose constructor callback depends on it — real ordering hazard.

## Detection heuristics
- Grep the diff for `new THREE`, `new GUI`, `new Stats`, `addEventListener`, `requestAnimationFrame` — then grep for the matching dispose/remove/cancel; absence is a finding.
- Grep for `disposables.push` — is the enclosing method called more than once per instance?
- In changed constructors, list assignment order top-to-bottom and check every `this.` read (including inside callbacks invoked synchronously) against it.
- Grep for `JSON.parse`, `localStorage` in constructor/init paths without try/catch.
- Grep for `clear(`, `remove(` on scene objects — is `.dispose()` also called on geometry/material?

**Example finding:** "second render → build volume pushed again → double-dispose on teardown"

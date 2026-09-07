# NaN Guard Review

Defect class: NaN/Infinity values entering and silently poisoning state, vertex buffers, bounding boxes, or camera math.

## What to hunt
- `parseFloat`/`Number()` results used without an `isFinite`/`Number.isFinite` check — malformed words like `G1 Xabc` yield NaN, and `??` does NOT catch NaN (NaN is not nullish).
- Values flowing into `Path`/vertex buffers, `BufferAttribute` arrays, or BatchedMesh geometry without validation at the parser boundary — one NaN vertex blanks the viewport with no error.
- `BoundingBox` updates: `Math.min/max` with NaN sticks min/max at NaN forever; any new min/max accumulation needs a non-finite rejection, and validity checks (`isValid`) must actually fail on NaN.
- Arc/helical math in the interpreter (`g2`/`g3`): division by zero-length chords, `Math.atan2`/`Math.sqrt` on degenerate inputs (e.g. full circle `G2 I5 J0` with no XY endpoint produced NaN vertices).
- Camera/controls math (SceneManager, frustum fitting, `controls.target`) fed from a bounding box that could be empty or poisoned.
- New numeric state fields initialized to `undefined` then used in arithmetic — `undefined + 1` is NaN and propagates.

## Known incidents in this repo
- PR #364: `BoundingBox.update()` accepted NaN/Infinity; one NaN stuck min/max at NaN forever while `isValid` still returned true, poisoning camera frustum and LineBox.
- PR #367: malformed numeric words (`G1 Xabc` → NaN) slipped through `??` fallbacks and permanently poisoned job state, vertex buffers, and the bounding box (blank viewport).
- PR #345: `G2 I5 J0` (full circle, no XY endpoint) produced NaN vertices; also State init switched to `undefined` risked NaN downstream (rolled back in-PR).

## Detection heuristics
- Grep the diff for `parseFloat`, `Number(`, `+str`-style coercion; check each result's downstream path for a finite guard.
- Grep for `Math.min`, `Math.max`, `Math.sqrt`, `Math.atan2`, `Math.acos`, `/ ` (division) in interpreter/geometry code — check degenerate inputs.
- Grep for `??` used as the sole validation on parsed numbers — it passes NaN through.
- New pushes into vertex/points arrays: trace each component back to its source; is there any point where a NaN could enter?
- Arithmetic on possibly-`undefined` state fields (un-homed axes after #401 are `undefined`).

**Example finding:** "`G1 Xoops` → NaN into buffer → blank viewport, no error"

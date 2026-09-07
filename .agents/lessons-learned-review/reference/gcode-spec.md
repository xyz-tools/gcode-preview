# G-code Spec Conformance Review

Defect class: command handlers that don't match documented firmware semantics.

## What to hunt
- Every new/changed handler in the interpreter must be checked against the firmware docs it claims to implement (Marlin, Smoothieware, RepRapFirmware). Cite the doc; don't trust the PR body's paraphrase.
- Side effects on *all* axes including E: offset/reset commands affect the extruder too. G92.1 must reset the E offset, not just XYZ (Smoothieware semantics — flagged on #456, where the underlying G92 also never implemented `positionShift` for E).
- Offset model consistency: this repo models G92 as a `positionShift` offset (no teleporting the toolhead — issue #179 / PR #436); new handlers must integrate with that model, and naming is reserved for M206/M428 workspace offsets — don't overload `positionShift` for those.
- Firmware-specific overloads: the same command means different things per firmware — RRF `G10` is *both* retract (no params / P+L absent) and set-tool/workspace-offsets. A handler that implements one meaning must not corrupt state when fed the other form.
- Arc semantics (G2/G3): direction (CW/CCW), plane, full-circle form (`I`/`J` with no XY endpoint), and helical Z interpolation toward the *endpoint* — all have shipped wrong here (#345, #370, sign-inverted `zDist`).
- Modal state: units (G20/G21), absolute/relative (G90/G91, M82/M83 for E separately), and current tool must be respected by new handlers; E and XYZ relative modes are independent in Marlin.
- Parameter defaults per spec: omitted params usually mean "unchanged", not 0 — and `0` is a legitimate explicit value (overlaps with review-falsy-zero, but here judged against the firmware doc).

## Known incidents in this repo
- PR #456: G92.1 handler didn't match Smoothieware semantics — must also reset the E offset; fix requested in-PR.
- PR #345: three arc bugs vs spec — absolute arcs targeting Z0 kept the previous Z, helical intermediate Z progressed *away* from the endpoint, and `G2 I5 J0` full circles produced NaN vertices.
- PR #370: sign-inverted `zDist` in `Interpreter.g2` made helical arcs interpolate Z away from the target (shipped since #211).

## Detection heuristics
- Grep the diff for new methods on the Interpreter class matching `g\d+|m\d+` and for `execute(`/dispatch-table additions.
- Grep for `positionShift`, `offset`, `G92`, `G10`, `M206`, `M428` — any touch requires checking E handling explicitly.
- In arc code, check every Z expression for direction/sign and every I/J/K/R default.
- Handlers that read only `x`,`y`,`z` params: ask what the firmware says about `e`, `f`, and firmware-specific params (`P`, `L`, `S`).
- No doc link in PR body or code comment for a new command → request the firmware citation.

**Example finding:** "G92.1 → E offset kept while XYZ reset → extrusion misrendered; cite the firmware doc violated"

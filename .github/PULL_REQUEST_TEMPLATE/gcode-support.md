<!-- Delete any section that doesn't apply. -->

## Command(s)

<!--
e.g. `G38.2`–`G38.5` (straight probe), `M206` (home offset).

Link the issue this closes ("Closes #123"), and any related ones — sibling
commands from the same split, the tracking issue, PRs this is stacked on.
-->

## Dialect & reference

<!--
Which firmware/slicer flavours this follows — Marlin, RepRapFirmware, LinuxCNC,
Mach3, Klipper — and a link to the spec or docs page.
Call out overloads where the same word means different things per firmware
(e.g. RRF's G10), and say which interpretation this PR implements.
-->

## What it does

<!-- The semantics being implemented, and any deliberate gaps (parameters ignored, variants left out). -->

## Interpreter state touched

<!--
Which parts of the state machine this reads or mutates — position, offsets,
relative/absolute modes, units, tool selection, layer detection.
Note interactions with existing modes (G90/G91, M82/M83, G20/G21).
-->

## Behavior changes

<!--
Does existing gcode parse or render differently now? Previously-unknown commands
becoming known can shift layer detection or travel/extrusion classification.
-->

## Public API changes

<!-- New exports, options, command types or state fields. Renames keep a @deprecated alias. -->

## Screenshots

<!-- If the command has a visible effect, before/after from the demo. Delete this section otherwise. -->

## Checks

- [ ] `npm run check` passes (test + typeCheck + lint)
- [ ] `npm run test:coverage` — `src/` still at 100%
- [ ] End-to-end coverage exists: a gcode snippet flows through
      `Parser.parseGCode` → `Interpreter.execute` (or `processGCode` /
      `processGCodeStream`), not just hand-built `GCodeCommand` objects
- [ ] Labelled `feature`/`enhancement` + `parser` / `interpreter`

Assisted by <tool> - <model>

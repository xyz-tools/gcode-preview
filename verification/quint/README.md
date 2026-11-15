# Quint spec bank

This directory is THE formal-verification layer: behavior-pinning specs bound to the implementation by ITF trace replay. Each spec's companion `.md` records every design decision with its reasoning and the alternatives considered.

A sibling bank, [`../quint-next/`](../quint-next/README.md), specifies the system as it *would* work designed from scratch — normative, firmware-conformant, intentionally divergent from the current implementation, and unbound by design.

## Authority policy

The implementation is the source of truth unless a clause says otherwise. Every command transition in `lib/printer-core.qnt` carries a three-field annotation: its **Authority** (Marlin documentation, the RepRap wiki, RepRapFirmware documentation, or none), the **Library stance** (conforms, pinned-divergence, or library-invented), and its **Exclusions**. A replay failure therefore has an arbitration rule: the spec is stale unless the failing clause cites an external authority, in which case the divergence is surfaced for a deliberate decision rather than silently re-pinned.

## Design principles

### One semantics, written once

The printer-state transitions live in `lib/printer-core.qnt`: a `PrinterState` record, a `Command` sum type, and a single pure `applyCommand`. The interpreter machine folds it; the equivalence machine runs two states through the *same* function with a separately defined re-encoding.

The reason is falsifiability. Transitions hand-transcribed into both machines would make the equivalence theorem compare two copies of the same hand, an identity no simulation could falsify. With one shared function, its invariant genuinely checks that re-encoding and interpretation commute.

### Invariants that can fail

Every machine carries ghost state that makes its defining theorem checkable. The interpreter tracks ghost logical positions (invariant: `physical = logical + shift` on every known axis) and ghost move counters (invariant: the stats classification partitions zero-length moves exactly). Streaming states its confluence claim — at document exhaustion the emitted lines equal the oneshot split — as an invariant over every trace.

Bookkeeping invariants are not enough, because a wrong transition relation would still satisfy them. The ghost invariants were mutation-tested during construction: breaking a transition clause is caught by simulation in milliseconds.

### Corpora sized to the machine, and kept fresh

Trace budgets live in the runner manifest (`scripts/quint-specs.mjs`), each machine samples two seeds, and every companion tables its coverage minima against measured event counts (streaming's stutter share is 8.6%).

A uniform per-spec budget from one frozen seed fits no machine: a small machine spends most of it on stutter steps while rare modes stay seed luck. Sizing each budget to the machine and measuring coverage keeps every modeled mode exercised.

Freshness is enforced, not trusted. The check runner adds a fresh-seed simulation lane each run, and a trace-freshness gate regenerates every corpus and fails when a spec edit lands without regenerated traces, so committed traces cannot drift from their spec.

### Integer-exact replay

Replays compare through `src/__tests__/helpers/itf-replay.ts` (shared, not copy-pasted) and `centiMismatch`: the implementation value scaled by 100 must round to exactly the spec's integer, with sub-`1e-9` slack reserved for float noise.

There is no epsilon, because an epsilon would quietly give away the integer model's precision.

## The specs

The spec text reads as implementation-independent semantics on purpose: comments that cite source paths rot silently, while the replay suites bind each spec to the code mechanically. This table is the one place that maps a spec to the implementation it pins.

| Spec | Models | Implementation it pins | Replay suite |
| --- | --- | --- | --- |
| `lib/printer-core.qnt` | The single printer-state semantics every interpreter-flavored machine folds: G0/G1, G2/G3 endpoints, G20/G21, G28, G31/G38.x probes, G92/G92.1, M82/M83, T0–T7, and the zero-length-move classification | `src/interpreter/commands/*`, `src/state.ts`, `src/job-stats.ts`, `src/units.ts` | through `interpreter.qnt` and `encoding-equivalence.qnt` |
| `lib/scale.qnt` | The centi-millimeter grid and read-time inch conversion | `src/units.ts` | through the machines that import it |
| `interpreter.qnt` | The printer state machine over the core, with ghost logical positions and stats-partition invariants | `src/interpreter.ts`, `src/job.ts` | `src/__tests__/interpreter.ts` |
| `encoding-equivalence.qnt` | Shift-frame equivalence: a toolpath re-encoded into a G92-shifted workspace reaches the identical physical state | `src/interpreter/commands/*`, `src/state.ts`, `src/job.ts` | `src/__tests__/job.ts` |
| `streaming.qnt` | The chunk-boundary carry buffer under nondeterministic splits, with conservation and confluence-with-oneshot invariants | `src/helpers/split-chunk.ts` | `src/__tests__/split-chunk.ts` |
| `slicer-detector.qnt` | The write-once slicer-classification latch, its first-match priority order, and the detection window | `src/parser/slicer-detector.ts`, `src/parser/gcode-parser.ts`, `src/parser/metadata-parser-base.ts`, `src/parser/*-parser.ts` | `src/__tests__/parser/slicer-detector.ts` |
| `thumbnail.qnt` | The online thumbnail comment protocol: begin/data/end, restarts, validity checks | `src/parser/gcode-parser.ts`, `src/thumbnail.ts` | `src/__tests__/parse-thumbnail.ts` |
| `layer-indexer.qnt` | Layer assignment across streamed chunks: strategy choice, layer-comment versus z-change assignment, non-planar collapse, the full per-layer partition | `src/indexers.ts`, `src/job.ts`, `src/parser/gcode-parser.ts` | `src/__tests__/indexers.ts` |
| `lifecycle.qnt` | The observable public-API lifecycle of `GCodePreview`: process/clear/render/resize/dispose ordering, predicted outcomes, renderer call counts | `src/gcode-preview.ts`, `src/scene-manager.ts` | `src/__tests__/renderer-smoke.ts` |

When a spec and its sources drift apart, the replay suite fails CI — not a comment. Each spec's sibling `.md` also carries Mermaid diagrams of its machine, rendered inline by GitHub.

## Layout and running

`lib/` holds pure modules validated by sibling `*_test` modules; runnable machines sit at the root with traces under `traces/<spec>/`. Conventions are codified in `STYLE.md`. If you're changing implementation code the bank pins, read `AGENTS.md` first: it covers the inner loop, how to arbitrate a failing replay, and what never to do to get green.

Two commands cover the bank: `npm run quint:test` (semantic runs, both invariant lanes, freshness gate) and `npm run quint:traces` (regenerate all corpora).

# Quint specs of gcode-preview's state machines

This directory holds [Quint](https://quint-lang.org) formal specifications of the library's discrete state machines. Each `.qnt` file is one spec; each models what the TypeScript source actually does, with integer-only state (lengths are centi-millimeters, mm × 100).

The specs are the intended semantics; the vitest replay keeps them honest against the real code. Every state in a trace records which input produced it, so a trace doubles as a program — a G-code snippet, a chunk sequence, or an API call sequence — that a replay suite feeds to the real implementation and compares step by step. Neither the spec nor the implementation can drift without CI failing.

## The specs

The spec text reads as implementation-independent semantics on purpose: comments that cite source paths rot silently, while the replay suites bind each spec to the code mechanically. This table is the one place that maps a spec to the implementation it pins.

| Spec                       | Models                                                                                                                                                                                       | Implementation it pins                                                                                            | Replay suite                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `interpreter.qnt`          | Printer-state effects of G0/G1, G2/G3 arcs, G20/G21 units, G28 homing, G31/G38.x probes (incl. the z-clamp rule), G92/G92.1 workspace shifts, M82/M83 extrusion modes, T0–T7 tool selection, and the zero-length-move stats classification | `src/interpreter/commands/*`, `src/state.ts`, `src/job-stats.ts`, `src/units.ts`                                   | `src/__tests__/interpreter.ts`           |
| `encoding-equivalence.qnt` | Shift-frame equivalence: the same toolpath expressed in a G92-shifted workspace reaches the identical physical state                                                                          | `src/interpreter/commands/*`, `src/state.ts`, `src/job.ts`                                                         | `src/__tests__/job.ts`                   |
| `streaming.qnt`            | Chunk-boundary carry buffer under nondeterministic splits, with conservation and prefix-correctness invariants                                                                                | `src/helpers/split-chunk.ts`                                                                                       | `src/__tests__/split-chunk.ts`           |
| `slicer-detector.qnt`      | Write-once slicer-classification latch and its first-match priority order                                                                                                                     | `src/parser/slicer-detector.ts`, `src/parser/gcode-parser.ts`, `src/parser/metadata-parser-base.ts`, `src/parser/*-parser.ts` | `src/__tests__/parser/slicer-detector.ts` |
| `thumbnail.qnt`            | Online thumbnail comment protocol (begin/data/end, restarts, validity checks)                                                                                                                 | `src/parser/gcode-parser.ts`, `src/thumbnail.ts`                                                                   | `src/__tests__/parse-thumbnail.ts`       |
| `layer-indexer.qnt`        | Layer-indexing automaton across streamed chunks: strategy choice, layer-comment versus z-change assignment, non-planar collapse                                                               | `src/indexers.ts`, `src/job.ts`, `src/parser/gcode-parser.ts`                                                      | `src/__tests__/indexers.ts`              |
| `lifecycle.qnt`            | Observable public-API lifecycle of `GCodePreview` (process/clear/render/resize/dispose ordering with predicted outcomes)                                                                      | `src/gcode-preview.ts`                                                                                             | `src/__tests__/gcode-preview.ts`         |

When a spec and its sources drift apart, the replay suite fails CI — not a comment.

Each spec also has a sibling Markdown file (`interpreter.md`, `streaming.md`, …) with Mermaid diagrams of its state machine, rendered inline by GitHub for an at-a-glance view of the model.

## Running everything

Every spec follows the same conventions: an `init` and `step` action, an `allInvariants` value, and semantic runs named `*Test`. One script runs all semantic tests plus a seeded invariant simulation for every spec, and CI runs it on each pull request:

```sh
npm run quint:test
```

## Regenerating the traces

The ITF traces in `traces/<spec name>/` are committed and reproducible. They are produced with a fixed seed, so regenerating yields the same states (only the `#meta` timestamp in each file header changes):

```sh
npm run quint:traces
```

Each spec gets 15 traces of 25 states (init plus 24 steps). Integers in the ITF files are encoded as `{"#bigint": "..."}` objects, which the replay suites unwrap before comparing against the TypeScript state. The replay suites run as part of the normal vitest suite, so every CI leg checks the committed traces against the implementation.

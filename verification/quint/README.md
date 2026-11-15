# Quint spec bank

This directory is THE formal-verification layer: behavior-pinning specs bound to the implementation by ITF trace replay. It is the second generation of the bank — a deliberate four-lens critique of the first generation (formal rigor, architecture, binding strength, semantic fidelity) found structural weaknesses worth rebuilding for, not patching. Each spec's companion `.md` records every design decision with its reasoning, the alternatives considered, and what v1 did instead.

A sibling bank, [`../quint-next/`](../quint-next/README.md), specifies the system as it *would* work designed from scratch — normative, firmware-conformant, intentionally divergent from the current implementation, and unbound by design.

## Authority policy

The implementation is the source of truth unless a clause says otherwise. Every command transition in `lib/printer-core.qnt` carries a three-field annotation: its **Authority** (Marlin documentation, the RepRap wiki, RepRapFirmware documentation, or none), the **Library stance** (conforms, pinned-divergence, or library-invented), and its **Exclusions**. A replay failure therefore has an arbitration rule: the spec is stale unless the failing clause cites an external authority, in which case the divergence is surfaced for a deliberate decision rather than silently re-pinned.

## What v2 changes, and why

**One semantics, written once.** v1 hand-transcribed the printer-state transitions into both `interpreter.qnt` and `encoding-equivalence.qnt`, which made the equivalence theorem compare two copies of the same hand — an identity no simulation could falsify. v2 extracts `lib/printer-core.qnt`: a `PrinterState` record, a `Command` sum type, and a single pure `applyCommand`. The interpreter machine folds it; the equivalence machine runs two states through the *same* function with a separately defined re-encoding, so its invariant now genuinely checks that re-encoding and interpretation commute.

**Invariants that can fail.** v1's invariants were bookkeeping a wrong transition relation would still satisfy. Every v2 machine carries ghost state that makes its defining theorem checkable: the interpreter tracks ghost logical positions (invariant: `physical = logical + shift` on every known axis) and ghost move counters (invariant: the stats classification partitions zero-length moves exactly); streaming promotes its confluence claim — at document exhaustion the emitted lines equal the oneshot split — from one hand-built test to an invariant over every trace. These were mutation-tested during construction: breaking a transition clause is caught by simulation in milliseconds.

**Corpora sized to the machine, and kept fresh.** v1 generated 15×24-step traces per spec from one frozen seed; for streaming that corpus was ~85% stutter steps. v2 budgets live in the runner manifest (`scripts/quint-specs.mjs`), each machine samples two seeds, and every companion tables its coverage minima against measured event counts (streaming's stutter share is now 8.6%). The check runner adds a fresh-seed simulation lane each run, and a trace-freshness gate regenerates every corpus and fails when a spec edit lands without regenerated traces — closing the one drift path v1's design left open.

**Exactness restored.** Replays compare through `src/__tests__/helpers/itf-replay.ts` (shared, not copy-pasted) and `centiMismatch`: the implementation value scaled by 100 must round to exactly the spec's integer, with sub-`1e-9` slack reserved for float noise. The epsilon that quietly gave away the integer model's precision is gone.

## Layout and running

`lib/` holds pure modules validated by sibling `*_test` modules; runnable machines sit at the root with traces under `traces/<spec>/`. Conventions are codified in `STYLE.md`. The same two commands cover v1 and v2: `npm run quint:test` (semantic runs, both invariant lanes, freshness gate) and `npm run quint:traces` (regenerate all corpora).

## Migration status

Complete. All seven machines live here on the shared core and conventions, each with its critique-driven improvements (multi-line chunk events and representative-line sets in `slicer-detector`; varied and padded payloads in `thumbnail`; the full per-layer partition in `layer-indexer`'s trace contract; a snippet menu and renderer-stub harness for `lifecycle`). The v1 bank and its replay suites were retired in the change that adopted this one.

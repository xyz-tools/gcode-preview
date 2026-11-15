# Quint-next: the from-scratch design bank

This directory answers a different question than [`../quint/`](../quint/README.md). The main bank pins what the system *does*; this one specifies what the system *would do* if designed from scratch, spec-first. It is normative: where it differs from the current implementation, the difference is intentional, and each companion `.md` carries a **Divergence ledger** — Aspect, current implementation, from-scratch design, and why the design works better.

## The design charter

Firmware conformance is the default: Marlin and RepRap documented semantics are the baseline, cited per clause, and any deliberate departure needs a stated reason. Properties are designed in rather than retrofitted — mode-independence and streaming refinement hold by construction and are stated as checked invariants. API contracts are explicit, with designed outcomes for every call ordering.

The headline design decisions, from the ledgers: G90/G91 relative positioning exists (with Marlin's coupling to extrusion mode), and mode-independence is a checked law; G28 honors axis words with per-axis homing knowledge replacing the single homed flag; the zero-length-move stats classify by *physical extrusion delta* (negative is a retraction, positive a prime), valid in both E modes; probes travel to their commanded target with no invented clamp; the splitter canonicalizes CRLF and has an explicit end-of-stream flush, making chunking-refines-oneshot an invariant; `dispose` is absorbing, backed by a resource-ledger invariant, and use-after-dispose throws a descriptive error instead of silently resurrecting a renderer.

## Unbound by design

This bank has no vitest replay and no trace corpora: run against the current implementation it would fail — that is what makes it a design artifact rather than a regression net. Its gate is internal consistency, wired into the same `npm run quint:test` as the main bank: every module's semantic `*Test` runs plus two invariant-simulation lanes (pinned seed and fresh seed). If the library ever moves toward this design, each ledger row is one deliberate migration step, and the corresponding machine graduates into the main bank by gaining a trace corpus and a replay suite.

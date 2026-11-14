# Quint spec of the interpreter state machine

This directory holds a [Quint](https://quint-lang.org) formal specification, `interpreter.qnt`, of the printer-state effects of the position and extrusion G-codes: G0/G1 moves, G20/G21 units, G28 homing, G92 and G92.1 workspace shifts, M82/M83 extrusion modes, and T0–T7 tool selection. Each action in the spec mirrors one handler in `src/interpreter/commands/`, and all lengths are kept as integers in centi-millimeters so the model stays exact.

The spec is the intended semantics; the vitest replay keeps it honest against the real interpreter. Every state in a trace records which command was taken and with which words, so a trace doubles as a G-code program that a replay harness can feed to the real `Interpreter` and compare step by step.

## Running the tests and invariants

The semantic tests (G92 round-trips, bare G92, G92.1, M82/M83 accounting, G20 inch conversion, un-homed G92) and the invariants `toolInRange`, `unknownAxisIsZero` and `homedImpliesKnown` (checked together as `allInvariants` by seeded random simulation) both run with one script, which CI runs on every pull request:

```sh
npm run quint:test
```

## Regenerating the traces

The ITF traces in `traces/<spec name>/` are committed and reproducible. They were produced with a fixed seed, so regenerating them yields the same states (only the `#meta` timestamp in the file header changes):

```sh
npm run quint:traces
```

The replay harness in `src/__tests__/interpreter.ts` (the "Quint spec trace replay" suite) rebuilds each trace step as a G-code line, runs it through the real parser and interpreter, and compares the resulting `State` field by field. It runs as part of the normal vitest suite, so every CI leg checks the committed traces against the implementation.

This writes 15 traces of 25 states each (the init state plus 24 commands). Integers in the ITF files are encoded as `{"#bigint": "..."}` objects, not plain JSON numbers, so a reader should unwrap them before comparing against the TypeScript state.

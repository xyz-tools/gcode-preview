# Quint v2 spec style guide

One page, binding for every spec under `verification/quint/`. Library modules live in `lib/` (pure, no state, never run as machines); runnable machines live at this directory's root. A file's module name is its basename with dashes as underscores.

## State and event records

A machine has exactly two state variables: `var s: <Spec>State`, a record holding all semantic state, and `var ev: Event`, the trace-contract record describing the step that was just taken. Transitions are pure: `pure def next(s, ...): <Spec>State`, with actions reduced to recording `ev` and `s' = next(s, ...)`. No scattered scalar vars, no `keep*` frame actions.

Ghost fields used to make invariants falsifiable (logical positions, prev-value monotonicity ghosts, conservation counters) live inside `s` and are named `ghost*`. They exist for property expression; companions say so.

## Sum types

Every internal enum — phases, modes, command codes, classifications — is a Quint sum type, so illegal values are unrepresentable and well-formedness invariants are unnecessary. Optional words use the `Word = Some(int) | None` type from `lib/printer-core.qnt`.

Inside `ev` only plain `str`, `int` and `bool` are allowed, for ITF and replay ergonomics. They are derived from the sum types in one place per machine (and from `printer_core::cmdTag` for command tags), never assigned as free literals.

## Naming and casing

Constants are `SCREAMING_SNAKE` (`CENTI`, `STEP_MENU`). Types and sum-type constructors are `PascalCase`. Defs, actions and vars are `camelCase`. The stutter action, when a machine can exhaust its input, is named `stutter` and records `ev` with tag `"stutter"`; machines whose step is always enabled have no stutter at all.

Every runnable machine defines `init`, `step` (always enabled), `val allInvariants`, and semantic runs named `*Test`. Every machine carries at least one invariant that would fail if a transition were mis-transcribed — ghost state is the tool.

## Weighted choice

One idiom: weights live in data, as a literal `List` in which each alternative appears as many times as its weight.

```quint
pure val STEP_MENU: List[StepKind] = [Move, Move, Move, Shift, Probe, Rare]

action step = {
  nondet k = STEP_MENU.indices().oneOf()
  dispatch(STEP_MENU[k])
}
```

No `1.to(N).oneOf()` if-chains with percentages computed in comments. Changing a weight is a data edit the diff shows directly.

## Mandatory header fields

Every `.qnt` opens with a doc comment carrying, in order: a one-paragraph description; `Unit:` — the unit ID(s) it pins from `.context/formal-verification/mapping-data.json` (IS-\*, PA-\*, ST-\*, GE-\*, JL-\*, RL-\*); `Authority policy:` — a pointer to the Authority annotations section below; `Companion:` — the sibling `.md` basename.

## Authority annotations

The implementation is the source of truth; v2 specs pin behavior. Every command or transition carries a three-field block in its doc comment:

- **Authority:** Marlin docs / RepRap wiki / RepRapFirmware docs / none.
- **Library stance:** conforms / pinned-divergence / library-invented.
- **Exclusions:** what the model cannot express (words, modes, hardware).

Divergences are pinned decisions, stated neutrally — never editorialized. Arbitration on replay failure: the spec is stale unless the failing clause is marked *conforms* against an external authority, in which case it is a semantics regression.

## Trace contract

Traces live in `verification/quint/traces/<spec>/`, generated with `npx quint run --out-itf ... --main <module>` per seed. Seed `0x67c0de2026` comes first and at least one more seed follows. Budgets (`--n-traces`, `--max-steps`) are sized to the machine's own diameter, then event coverage is measured over the generated corpus; the companion records budgets, the machine's stated minima (no machine mode under ~20 replayed exercises; low stutter share) and the measured counts.

Replays join the existing vitest file for the area, in a new describe block `'<spec> v2 spec trace replay'`, importing all ITF plumbing from `src/__tests__/helpers/itf-replay.ts` (`listTraceFiles`, `readTrace`, `itfInt`/`itfBool`/`itfStr`/`itfList`/`itfRecord`, `centiMismatch`). Comparisons are integer-exact via `centiMismatch` — no epsilon. The guard test fails, never skips, on an empty trace directory.

## Temporal claims

Any temporal claim in a spec comment or companion — monotone, never, always, eventually — must exist as a checked invariant (usually over ghost state) or be explicitly tagged OPEN. There is no third option.

# Guidelines: iterating on gcode-preview with the Quint spec bank

You are changing implementation code in a repo where behavior is pinned by Quint specs that are bound to the code through recorded traces. The specs are a safety net that tells you, mechanically, when you changed behavior. Your job is to keep that net working. Don't cut holes in it to get green.

The bank lives in `verification/quint/`. Read `verification/quint/README.md` and `verification/quint/STYLE.md` once before your first edit.

## 1. Before you touch code

- Find the spec that pins the files you're about to edit. The traceability table in `verification/quint/README.md` maps each spec → implementation files → replay suite. It is the only place that mapping lives: specs never cite `src/` paths.
- Note the replay suite for that spec, e.g. `src/__tests__/interpreter.ts` → describe block `'<spec> spec trace replay'`.
- Read the **Authority / Library stance / Exclusions** block on each clause you'll affect. For G-code commands it lives on the `Command` type in `verification/quint/lib/printer-core.qnt`; for everything else (streaming, thumbnail, slicer detection, layer indexing, lifecycle) it lives on the transition in that machine's own `.qnt`. That block decides who wins if replay fails (see §3).

## 2. The inner loop

| When | Run | Cost |
| --- | --- | --- |
| Every iteration | `npx vitest run <replay suite file>` plus the tests for your area | seconds |
| Before saying "done" | `npm run test:coverage` (full suite + 100% coverage gate) and `npm run quint:test` | about a minute |
| Only if you edited a `.qnt` | `npm run quint:traces`, then `npm run quint:test` again | about a minute |

`npm run quint:test` runs three gates per spec: the semantic `*Test` runs, invariant simulation with both a pinned seed and a fresh seed, and a trace-freshness gate that regenerates every corpus and fails if committed traces don't match the spec. CI runs the same command in the pr-check job, so if it's red locally it will be red in CI.

## 3. When a replay test fails: arbitrate, don't patch

A replay failure means the implementation no longer does what the spec says. Decide which side is wrong, in this order:

1. **Is the changed behavior part of your task?**
   - No: you broke something. Fix the code, not the spec.
   - Yes: go to step 2.
2. **Check the failing clause's Authority block** (in `lib/printer-core.qnt` for G-code commands, otherwise in the machine's own `.qnt`).
   - Stance `conforms` with an external authority (Marlin, RepRap wiki, RRF docs): the spec is backed by firmware docs, so this is a semantics regression. Don't re-pin it. Stop and surface the divergence to the user with the cited authority and what your change does instead.
   - Stance `pinned-divergence`, `library-invented`, or Authority `none`: the spec is just pinning current behavior, and an intentional change may update it. Follow §4.
3. **Can't tell whether the change is intended?** Stop and ask. Silently re-pinning a spec to match new code destroys the whole point of the bank.

### Never do these to get green

- Add an epsilon or tolerance. Replay comparisons are exact on purpose: millimeter values go through `centiMismatch` (the scaled value must round to exactly the spec's centi-millimeter integer), and everything else compares with `===`.
- Skip, `.todo`, `.skip`, or weaken a `'… spec trace replay'` describe, or its guard test (it fails, never skips, on an empty trace directory).
- Hand-edit, delete, or cherry-pick `.itf.json` files. Traces are generated only by `npm run quint:traces`.
- Shrink `nTraces` / `maxSteps` in `scripts/quint-specs.mjs` to dodge a failure.
- Re-run the fresh-seed lane until it passes. A fresh-seed failure is a real counterexample: reproduce it with the printed seed (`--seed=0x…`).
- Comment out an invariant or remove it from `allInvariants`.

## 4. When you intentionally change pinned behavior

Do all of this in the same commit as the code change:

1. **Edit the spec transition and update its Authority block.** A changed stance is stated neutrally; never editorialize.
2. **Keep an invariant that can fail.** If the new behavior adds a mode, add the ghost state or invariant that would catch a mis-transcribed transition. Any temporal word you write in a comment ("never", "always", "monotone", "eventually") must be a checked invariant or explicitly tagged OPEN.
3. **Prove the spec still has teeth.** Temporarily break the clause you just changed (flip a condition, drop an update), and confirm that `npm run quint:test` or the replay suite fails. Then revert. A spec that can't fail is decoration. This repo has no spec-mutant gate in CI, so this manual check is the only protection.
4. **Regenerate the traces** with `npm run quint:traces` and commit them alongside the spec. Expect only the `#meta` timestamp to churn in files whose states didn't change.
5. **Check coverage of the new mode.** No machine mode should get fewer than about 20 replayed exercises. If the new mode is rare, change the machine's weight list (weights are data: a literal `List` where each alternative repeats as many times as its weight, e.g. `STEP_MENU`, or `TokenBag`/`LenBag` in streaming) or resize that machine's budget in `scripts/quint-specs.mjs`, then update the coverage table in the companion `.md`.
6. **Update the companion `.md`**: record the decision with its reasoning and the alternatives considered, and update the Mermaid diagram if the machine changed shape.
7. **Update the README traceability table** if implementation files were added, moved or renamed. This table has been lost once in a README rewrite, so make sure it survives any edit you make there.

## 5. Spec style rules (from STYLE.md, the ones agents trip on)

- No `src/` paths in `.qnt` files. Specs read as implementation-independent G-code and firmware semantics.
- A machine has exactly two vars: `s: <Spec>State` and `ev: Event`. Transitions are pure defs named `apply<Event>` (`applyChunk`, `applyMove`); never name one `next`, which is a Quint built-in. No scattered scalar vars and no `keep*` actions.
- Internal enums are sum types. Fields in `ev` are plain `str`/`int`/`bool` only, derived in one place.
- Every runnable machine has `init`, an always-enabled `step` (or a `stutter` action), `val allInvariants`, and `*Test` runs.
- Each `.qnt` opens with a doc comment carrying `Unit:`, `Authority policy:` and `Companion:`.
- No version labels anywhere (no "v1", "v2", "old", "new"); git history holds that record. Exception: the Mermaid keyword `stateDiagram-v2` is syntax, not a version label, so don't strip it.

## 6. `verification/quint-next/` is not your target

quint-next is the normative from-scratch design bank. It deliberately diverges from the current code, has no traces and no replay, and its gate is internal consistency only.

- Don't make code changes to "match quint-next" unless your task explicitly says so.
- Don't add traces or replay suites to quint-next.
- If your task is to implement a quint-next design, follow its Divergence ledger:
  - Each ledger row is one migration step.
  - The machine graduates into `verification/quint/` by gaining a trace corpus and a replay suite.
  - Update the ledger and both READMEs in the same change.

## 7. Failure triage

| Symptom | What it means | Do |
| --- | --- | --- |
| Replay mismatch in `'<spec> spec trace replay'` | The code diverged from pinned behavior | Follow §3 |
| `STALE TRACES for <spec>` and you edited that `.qnt` | You forgot to regenerate | `npm run quint:traces` and commit the traces |
| `STALE TRACES` and you did not edit any `.qnt` | Probably a Quint version change. The devDep is `^0.33.1` (a caret range), and the simulator's random sequence for a given seed isn't guaranteed stable across versions | Check `npx quint --version` against the lockfile. Don't blindly regenerate; report it |
| `quint test` failure (a `*Test` run) | A semantic run in the spec broke, so your spec edit is wrong | Fix the spec |
| Invariant violated in the fresh-seed lane only | Exploration found a real counterexample | Reproduce with the printed seed. Decide whether the spec or the code is wrong (§3) |
| Evaluator download or network error | Infrastructure, not a verdict | Retrying is fine. Never treat a verdict failure as infrastructure |
| Replay breaks after renaming a private field | The slicer-detector and thumbnail replays read private state through a structural cast | Update the replay's accessor. The spec doesn't change |

## 8. Blind spots: the bank does not cover these

- Geometry and float math (tube building, rendering) are deliberately not specced. Rely on the vitest suite and property tests.
- A spec can pass vacuously. There is no check that every mode was actually reached. If you add a mode, measure its coverage yourself (§4.5).
- Spec mutants don't run in CI. Your manual check in §4.3 is the only proof the invariants can still fail.
- Lifecycle replay lives in `src/__tests__/renderer-smoke.ts`, not in a lifecycle test file.

## 9. Repo rules that still apply

- New tests join the existing test file for that area. No standalone regression files.
- 100% coverage on every `src/` file, or CI fails.
- No breaking public-API renames. Keep old names as `@deprecated` aliases.
- "used to …" tombstone comments in `src/` are house style. Don't strip them.
- Stay in your task's scope. If the specs reveal an unrelated issue, report it; don't fix it in the same change.
- Commit only when asked, and never push or open a PR without the user's go-ahead.

## Definition of done

- [ ] `npm run test:coverage` is green, including every `'… spec trace replay'` block, at 100% coverage
- [ ] `npm run quint:test` is green (semantic runs, both seed lanes, trace freshness)
- [ ] If behavior changed intentionally: the spec, Authority block, regenerated traces, companion `.md` and README table are all in the same commit
- [ ] If the spec changed: you broke the changed clause once, saw it fail, and reverted
- [ ] No epsilon, no skipped replay, no hand-edited traces, no shrunk budgets
- [ ] Any `conforms` divergence was surfaced to the user, not re-pinned

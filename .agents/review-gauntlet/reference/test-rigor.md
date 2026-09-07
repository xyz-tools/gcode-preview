# Test Rigor Review

Defect class: tests that don't actually protect against the bug they claim to cover.

## What to hunt
- Bug fixes without a red-first regression test: the test must fail on the pre-fix code. If it can't be shown to go red, it proves nothing.
- Tests that take a shortcut around the real code path: calling a helper directly instead of the real streaming path (`parseStream`/`readStream` chunk-by-chunk), feeding the interpreter directly instead of dispatching through `execute()`, or constructing internal state by hand instead of parsing real G-code.
- Tests asserting *execution* rather than *behavior*: spies checking "method X was called", snapshotting internals, or asserting a value the test itself set up. Maintainer critique on #348: "it's enforcing execution rather than behaviour" — a coverage test there nearly enshrined the latent `closed` bug instead of exposing it.
- Missing edge case that motivated the change: Z0, E0/negative E (retraction), chunk boundaries, empty/no-newline input, tool index out of range.
- New standalone regression-test files. Repo policy: regression tests join the existing suite file for that area (e.g. add to `src/__tests__/interpreter.test.ts`, not `regression-370.test.ts`).
- Coverage games: this repo enforces 100% coverage on every src/ file with zero pins. Flag tests that exist only to touch lines (no meaningful assertion), and any new coverage exclusion comment (`/* istanbul ignore */`, `c8 ignore`, vitest coverage config edits).
- Mocks replacing three.js or parser internals so broadly that the assertion would pass even if the fix were reverted.

## Known incidents in this repo
- PR #348: a coverage test *enshrined* a latent bug — bare `closed` resolved to `window.closed`, and the test would have locked in the broken behavior; the maintainer had the bug fixed instead of tested.
- PR #353: streaming chunk-accumulation bug (`parser.lines` overwritten per chunk) shipped because tests didn't exercise the real multi-chunk streaming path; the follow-up equivalence harness (#416) later caught #417 the same way.
- PR #345: `execute()` dispatch was untested — arc handlers were tested directly, so a dispatch-level bug would have passed the suite; fix demanded in review.

## Detection heuristics
- Diff touches `src/` but adds nothing under `src/__tests__/` → ask where the regression test is (for fixes, not pure refactors).
- New `*.test.ts` file whose area already has a suite file — grep `ls src/__tests__/` and match by subject.
- `vi.fn()` / `vi.spyOn` followed by `toHaveBeenCalled` as the *only* assertion in a test.
- Tests that never feed multi-chunk input to streaming code: grep new tests for `parseStream|ReadableStream` vs direct `parser.parse(` on streaming-related fixes.
- Grep the diff for `istanbul ignore`, `c8 ignore`, `coverage` (config changes), `.skip(`, `.todo(`.
- A test named after the bug that passes with the fix reverted — spot-check by reading whether the assertion depends on the fixed behavior.

**Example finding:** "revert the fix → this test still passes"

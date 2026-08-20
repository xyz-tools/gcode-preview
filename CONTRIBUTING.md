# Contributing

We are open to your ideas and always willing to get you started! [talk to us on Discord](https://discord.gg/w2bsGRE6S4).

Maybe there is an [open issue](https://github.com/xyz-tools/gcode-preview/issues?q=is%3Aissue%20state%3Aopen%20-label%3Ademo%20-label%3A3.1%2B%20-label%3Ablocked%20-label%3Arefactor) that appeals to you?

Other things that are always helpful:

- testing different gcode files, from different slicers
- reporting bugs! A screenshot or a minimal gcode snippet goes a long way
- making GCode Preview suitable for different printer types, like Deltas, Belt printers, IDEX, etc. Even CNC machines
- documentation & examples
- unit tests

## Development setup

Run the dev setup:

```sh
npm i
npm run dev
```

This runs the demo app which is fairly complete in using the library's features.
If you don't need the demo app, just run `npm run dev:watch`.

## Before submitting a PR

Run the full check suite:

- `npm run test` for unit tests
- `npm run typeCheck` for typescript typings
- `npm run lint` for code style and formatting
- `npm run build` for a production build
- or all together: `npm run check` (test + typeCheck + lint)

To auto-fix simple issues: `npm run lint:fix` or `npm run prettier:fix`.

CI runs the same checks (`build`, `test`, `typeCheck`, `lint`) on Ubuntu with Node 22,
so make sure everything passes locally first.

## Review standards

Every change, **intended or not**, must be:

1. **Documented and visible.** Behavior changes (including bug fixes that alter
   rendering/output for existing files) must be called out explicitly in the PR
   description, not buried in the diff.
2. **Truly covered by tests, in a convincing way.** A test must fail before your
   change and pass after it. 
3. **Tested end-to-end where applicable.** Supporting a new gcode command requires
   at least one test that feeds a gcode snippet through the whole pipeline:
   `Parser.parseGCode` → `Interpreter.execute` (or the library's process entry point).
   Hand-instantiated `GCodeCommand` objects only prove the handler logic; they don't
   prove the parser maps the command word to the handler.

General test expectations:

- Tests should exercise dispatch through `Interpreter.execute()` whenever the
  behavior depends on it (e.g. mode-flipping sequences like `G91` → move → `G90` →
  move), not just call individual handler methods directly.
- Keep changes focused. If a feature touches multiple behaviors, add regression
  coverage for each of them separately.



# P1 reproduction: arc-defaults

Branch: `codex/p1-arc-defaults-repro`

Base: `c99c9db`. Implementation is unchanged. The regression test asserts the intended behavior and currently fails.

Run from this worktree:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p1-reproduction.ts
```

The environment flag avoids the Node 26 experimental web-storage conflict with happy-dom. Dependencies are linked to the original checkout’s existing node_modules; nothing was installed.

Only the GPU renderer is stubbed where necessary; no browser is required.

## Verified result

Expected: omitting J0 or an unchanged Y0 gives the same curved path as explicit parameters. Observed: both omitted-word cases contain only the start and endpoint. Explicit-parameter control passes; both regressions fail.

See [regression test](src/__tests__/p1-reproduction.ts). Tests deliberately remain failing until the implementation is fixed. No implementation fixes are included.

# P1 reproduction: quick-start

Branch: `codex/p1-quick-start-repro`

Base: `c99c9db`. Implementation is unchanged. The regression test asserts the intended behavior and currently fails.

Run from this worktree:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p1-reproduction.ts
```

The environment flag avoids the Node 26 experimental web-storage conflict with happy-dom. Dependencies are linked to the original checkout’s existing node_modules; nothing was installed.

Only the GPU renderer is stubbed where necessary; no browser is required.

## Verified result

Expected: construction and the README example succeed without buildVolume. Observed: TypeError reading x at src/scene-manager.ts:215 during construction. One regression test fails.

See [regression test](src/__tests__/p1-reproduction.ts). Tests deliberately remain failing until the implementation is fixed. No implementation fixes are included.

# P1 reproduction: stream-layer-metadata

Branch: `codex/p1-stream-layer-metadata-repro`

Base: `c99c9db`. Implementation is unchanged. The regression test asserts the intended behavior and currently fails.

Run from this worktree:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test -- src/__tests__/p1-reproduction.ts
```

The environment flag avoids the Node 26 experimental web-storage conflict with happy-dom. Dependencies are linked to the original checkout’s existing node_modules; nothing was installed.

Only the GPU renderer is stubbed where necessary; no browser is required.

## Verified result

Expected: both ingestion modes retain layers at Z0.2 and Z0.4 with height 0.2. Observed: the split block loses the first Z/height and both extrusion paths land in one layer. Whole-file control passes; split-block regression fails.

See [regression test](src/__tests__/p1-reproduction.ts). Tests deliberately remain failing until the implementation is fixed. No implementation fixes are included.

# Workflow Correctness Review

Defect class: CI/CD workflows that test the wrong thing, waste runs, over-privilege, or break publishing.

## What to hunt
- Checkout ref: PR-triggered workflows must build/test/deploy the PR head, not `develop`. Check `actions/checkout` `ref:` (or its absence) against the trigger (`pull_request` vs `pull_request_target` vs `push`). This shipped twice (#162 previews, #163 tests — PRs were effectively untested).
- Wasted runs: jobs doing real work on `types: [closed]` or without path filtering (#443 — Firebase preview workflow ran pointlessly on close). Also verify any "teardown on close" step is actually supported by the action used — the #443 teardown was hallucinated.
- Missing explicit `permissions:` block on new/changed workflows (CodeQL flagged this on #372). Default GITHUB_TOKEN scope is too broad; declare least privilege per job.
- Merge/rebase collateral: does the diff silently delete or shrink a CI matrix (the three.js version matrix), re-pin a dependency range in package.json, or drop a job that exists on develop? Compare against `origin/develop`'s copy of the file, not just the hunks (#348 nearly merged exactly this).
- Release/publish config: npm publish uses OIDC trusted publishing — flag any reintroduction of `NPM_TOKEN` secrets (#393); `package.json` `repository.url` must match the real org (`xyz-tools/gcode-preview`) or provenance rejects the publish (#396).
- Trigger typos: branch names, `paths:` filters that exclude the workflow's own inputs, `workflow_dispatch` inputs never read.
- Action versions: unpinned `@main`/`@master` third-party actions in privileged workflows.

## Known incidents in this repo
- PR #162: PR-preview deploy checked out `develop` — previews never showed PR changes.
- PR #163: CI ran tests against `develop` — PRs merged effectively untested.
- PR #348 (caught in review): merging a stale branch would have silently deleted the three.js CI version matrix and re-pinned `three`.
- PR #372: CodeQL flagged a missing `permissions:` block on a workflow.
- PR #443 (caught in review): workflow ran on `closed` doing pointless work, plus a hallucinated (unsupported) preview-teardown step.
- PR #393: npm publish failed with a misleading 404 from an expired `NPM_TOKEN`; moved to OIDC trusted publishing.
- PR #396: provenance rejected the publish because `repository.url` still pointed at `remcoder/gcode-preview`.

## Detection heuristics
- In changed workflow files, grep for `actions/checkout` and inspect the `ref:` line (or note its absence) relative to the `on:` trigger.
- Grep for `types:` including `closed` and check what the job actually does there.
- Grep for `permissions:` — absent at both workflow and job level is a finding.
- `git diff origin/develop... -- .github/ package.json` and specifically look for *removed* lines: matrix entries, jobs, `^` / `~` version-range widenings turned into pins.
- Grep for `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and check `repository.url` / `publishConfig` in package.json if touched.

**Example finding:** "PR opens → workflow tests develop → red PR merges green"

#!/usr/bin/env node
// Builds the library at every commit in a range into devtools/dist/, so the
// benchmark page can measure a whole stretch of history in one browser session.
//
// Your working tree is never touched: each commit is checked out in a detached
// worktree (inside devtools/dist/, so lint ignores it too) that borrows this
// checkout's node_modules, so three/lil-gui are identical across every build
// and the only thing that varies is the library itself.
//
// Usage:
//   node devtools/sweep/build-commits.mjs                 # HEAD → develop, mainline only
//   node devtools/sweep/build-commits.mjs --base v3.0.0-alpha.5 --tip develop
//   node devtools/sweep/build-commits.mjs --all-commits    # include merged-branch commits
//   node devtools/sweep/build-commits.mjs --force          # rebuild shas already present
//
// Output: devtools/dist/<short-sha>.js plus devtools/dist/index.json (the
// catalog the benchmark page reads). Named `dist` on purpose: the repo's
// prettier and eslint ignore lists both carry a bare `dist`, which matches at
// any depth — so build artifacts stay out of `npm run lint` without editing a
// tracked config file.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEVTOOLS = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = resolve(DEVTOOLS, '..');
const BUILDS = join(DEVTOOLS, 'dist');
const INDEX = join(BUILDS, 'index.json');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const BASE = flag('base', 'HEAD');
const TIP = flag('tip', 'develop');
const WORKTREE = resolve(flag('worktree', join(BUILDS, '.worktree')));
const FORCE = has('force');
const FIRST_PARENT = !has('all-commits');

const git = (args, cwd = REPO) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// --- commit list -----------------------------------------------------------

function commitList() {
  const baseSha = git(['rev-parse', BASE]);
  const revListArgs = ['rev-list', '--reverse'];
  if (FIRST_PARENT) revListArgs.push('--first-parent');
  revListArgs.push(`${baseSha}..${git(['rev-parse', TIP])}`);
  const after = git(revListArgs).split('\n').filter(Boolean);
  // The base itself is the comparison's starting point, so it gets measured too.
  return [baseSha, ...after].map((sha) => {
    const [subject, date, author] = git(['show', '-s', '--format=%s%n%cI%n%an', sha]).split('\n');
    return { sha, short: sha.slice(0, 9), subject, date, author };
  });
}

// --- worktree --------------------------------------------------------------

function ensureWorktree() {
  if (!existsSync(WORKTREE)) {
    console.log(`Creating worktree at ${WORKTREE}`);
    git(['worktree', 'add', '--detach', WORKTREE, 'HEAD']);
  }
  // Every commit builds against THIS checkout's dependencies. That is the point:
  // a commit-to-commit comparison should not also swing three.js versions.
  const modules = join(WORKTREE, 'node_modules');
  if (!existsSync(modules)) symlinkSync(join(REPO, 'node_modules'), modules, 'dir');
}

function buildAt(sha) {
  git(['checkout', '--detach', '--force', sha], WORKTREE);
  git(['clean', '-fdx', '--exclude=node_modules', '--exclude=dist'], WORKTREE);

  const config = ['rollup.config.mjs', 'rollup.config.js'].find((name) => existsSync(join(WORKTREE, name)));
  if (!config) throw new Error('no rollup config at this commit');

  execFileSync(join(REPO, 'node_modules/.bin/rollup'), ['-c', config], {
    cwd: WORKTREE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' }
  });

  const built = join(WORKTREE, 'dist/gcode-preview.es.js');
  if (!existsSync(built)) throw new Error('build produced no dist/gcode-preview.es.js');
  return built;
}

// --- main ------------------------------------------------------------------

mkdirSync(BUILDS, { recursive: true });
const previous = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
const previousBySha = new Map(previous.map((entry) => [entry.sha, entry]));

const commits = commitList();
console.log(`${commits.length} commit(s): ${BASE} → ${TIP}${FIRST_PARENT ? ' (mainline only)' : ''}\n`);

ensureWorktree();

const entries = [];
let built = 0;
let reused = 0;
let failed = 0;

for (const [i, commit] of commits.entries()) {
  const position = `[${i + 1}/${commits.length}] ${commit.short}`;
  // Commits that don't touch src/ produce a byte-identical library; pointing
  // them at the previous build keeps them in the table without a rebuild.
  const srcTree = git(['rev-parse', `${commit.sha}:src`]);
  const twin = entries.find((entry) => entry.srcTree === srcTree && entry.ok);
  const cached = previousBySha.get(commit.sha);

  if (twin) {
    entries.push({ ...commit, srcTree, file: twin.file, ok: true, identicalTo: twin.short });
    reused++;
    console.log(`${position}  ${commit.subject}\n            ↳ src identical to ${twin.short}, reusing its build`);
    continue;
  }

  if (!FORCE && cached?.ok && cached.srcTree === srcTree && existsSync(join(BUILDS, cached.file))) {
    entries.push({ ...commit, srcTree, file: cached.file, ok: true });
    reused++;
    console.log(`${position}  ${commit.subject}\n            ↳ already built`);
    continue;
  }

  process.stdout.write(`${position}  ${commit.subject}\n            ↳ building… `);
  try {
    const file = `${commit.short}.js`;
    copyFileSync(buildAt(commit.sha), join(BUILDS, file));
    entries.push({ ...commit, srcTree, file, ok: true, builtAt: new Date().toISOString() });
    built++;
    console.log('ok');
  } catch (error) {
    const message = (error.stderr || error.message || String(error)).trim().split('\n').slice(-3).join(' ');
    entries.push({ ...commit, srcTree, ok: false, error: message });
    failed++;
    console.log(`FAILED — ${message}`);
  }
  // The catalog is rewritten every commit, so an interrupted sweep still
  // leaves the page a usable list of whatever finished.
  writeFileSync(INDEX, JSON.stringify(entries, null, 2));
}

writeFileSync(INDEX, JSON.stringify(entries, null, 2));

// Drop build files no longer referenced by the catalog (e.g. after --force).
const keep = new Set(entries.filter((entry) => entry.ok).map((entry) => entry.file));
for (const stale of previous) {
  if (stale.file && !keep.has(stale.file) && existsSync(join(BUILDS, stale.file))) {
    rmSync(join(BUILDS, stale.file));
  }
}

console.log(`\nDone — ${built} built, ${reused} reused, ${failed} failed.`);
console.log(`Catalog: ${INDEX}`);
if (failed) process.exitCode = 1;

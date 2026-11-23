// Version discovery and per-version import-map resolution, shared by all
// devtools pages that load gcode-preview builds.

import { DIST_ROOT, MODULES_ROOT } from './roots.js';

export const CDN = 'https://cdn.jsdelivr.net/npm';
export const CDN_API = 'https://data.jsdelivr.com/v1/packages/npm';
export const LOCAL_VERSION = 'local';

// Per-commit builds produced by sweep/build-commits.mjs are selected as
// 'commit:<file>', with <file> the name inside devtools/dist/.
export const COMMIT_PREFIX = 'commit:';

// Resolved from this module's own URL rather than an absolute path: devtools
// gets served at different roots depending on who is serving it (server.mjs,
// a VS Code live preview, …), and the catalog has to be findable under all of
// them. lib/versions.js → ../dist/.
export const BUILDS_URL = new URL('../dist/', import.meta.url).href;

// Best-effort snapshot used when the jsDelivr API is unreachable — it may lag
// behind npm, so treat it as "some versions", not "the versions".
const FALLBACK_VERSIONS = ['3.0.0-alpha.5', '2.18.0', '2.17.0', '2.16.0', '2.15.0'];

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

export async function loadVersions() {
  try {
    const data = await fetchJson(`${CDN_API}/gcode-preview`);
    return data.versions.map((v) => v.version);
  } catch (error) {
    console.warn('Could not list versions from jsDelivr, using fallback list', error);
    return FALLBACK_VERSIONS;
  }
}

// The commit builds sitting in devtools/dist/, oldest first. Absent catalog
// (nobody has run the sweep yet) is the normal case, not an error.
export async function loadCommitBuilds() {
  try {
    const entries = await fetchJson(`${BUILDS_URL}index.json`);
    return entries.filter((entry) => entry.ok && entry.file);
  } catch (error) {
    console.info('No commit builds available (run devtools/sweep/build-commits.mjs)', error);
    return [];
  }
}

export const commitValue = (build) => `${COMMIT_PREFIX}${build.file}`;

export function commitLabel(build) {
  const date = build.date ? build.date.slice(0, 10) : '';
  const subject = build.subject?.length > 60 ? `${build.subject.slice(0, 57)}…` : build.subject;
  return `${build.short} ${date} ${subject ?? ''}`.trim();
}

// Newest non-prerelease version of ANY major, so the default baseline tracks
// whatever is actually released. jsDelivr (and the fallback list) order
// versions newest-first, so the first match is the latest stable.
export function latestStable(versions) {
  return versions.find((v) => !v.includes('-'));
}

export function populateVersionSelect(select, versions, defaultValue, commitBuilds = []) {
  const add = (parent, value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    parent.appendChild(option);
  };

  add(select, LOCAL_VERSION, 'local build (this checkout)');

  if (commitBuilds.length) {
    const group = document.createElement('optgroup');
    group.label = 'commit builds';
    for (const build of commitBuilds) add(group, commitValue(build), commitLabel(build));
    select.appendChild(group);
  }

  const published = document.createElement('optgroup');
  published.label = 'published versions';
  for (const version of versions) add(published, version, version);
  select.appendChild(published);

  if (defaultValue) select.value = defaultValue;
}

// three/lil-gui served out of this checkout's node_modules — shared by the
// local build and every commit build, so a commit-to-commit comparison varies
// only the library.
function checkoutImports(entryUrl) {
  return {
    imports: {
      'gcode-preview': new URL(entryUrl, document.baseURI).href,
      three: new URL('three/build/three.module.min.js', MODULES_ROOT).href,
      'lil-gui': new URL('lil-gui/dist/lil-gui.esm.min.js', MODULES_ROOT).href
    }
  };
}

export async function buildImportMap(version) {
  if (version === LOCAL_VERSION) return checkoutImports(new URL('gcode-preview.es.js', DIST_ROOT).href);
  if (version.startsWith(COMMIT_PREFIX)) {
    return checkoutImports(`${BUILDS_URL}${version.slice(COMMIT_PREFIX.length)}`);
  }

  const pkg = await fetchJson(`${CDN}/gcode-preview@${version}/package.json`);
  const entry = pkg.module ?? pkg.main ?? 'dist/gcode-preview.es.js';
  const imports = { 'gcode-preview': `${CDN}/gcode-preview@${version}/${entry}` };

  // Resolve the version's own three/lil-gui ranges so each side runs against
  // the dependencies it was published for.
  const deps = { ...pkg.peerDependencies, ...pkg.dependencies };
  const paths = {
    three: (v) => `${CDN}/three@${v}/build/three.module.js`,
    'lil-gui': (v) => `${CDN}/lil-gui@${v}/dist/lil-gui.esm.min.js`
  };
  for (const dep of Object.keys(paths)) {
    if (!deps[dep]) continue;
    const resolved = await fetchJson(`${CDN_API}/${dep}/resolved?specifier=${encodeURIComponent(deps[dep])}`);
    imports[dep] = paths[dep](resolved.version);
  }
  return { imports };
}

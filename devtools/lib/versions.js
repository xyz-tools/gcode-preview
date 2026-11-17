// Version discovery and per-version import-map resolution, shared by all
// devtools pages that load gcode-preview builds.

export const CDN = 'https://cdn.jsdelivr.net/npm';
export const CDN_API = 'https://data.jsdelivr.com/v1/packages/npm';
export const LOCAL_VERSION = 'local';

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

// Newest non-prerelease version of ANY major, so the default baseline tracks
// whatever is actually released. jsDelivr (and the fallback list) order
// versions newest-first, so the first match is the latest stable.
export function latestStable(versions) {
  return versions.find((v) => !v.includes('-'));
}

export function populateVersionSelect(select, versions, defaultValue) {
  const options = [
    { value: LOCAL_VERSION, label: 'local build (this checkout)' },
    ...versions.map((v) => ({ value: v, label: v }))
  ];
  for (const { value, label } of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  if (defaultValue) select.value = defaultValue;
}

export async function buildImportMap(version) {
  if (version === LOCAL_VERSION) {
    return {
      imports: {
        'gcode-preview': new URL('/dist/gcode-preview.es.js', document.baseURI).href,
        three: new URL('/lib/three/build/three.module.min.js', document.baseURI).href,
        'lil-gui': new URL('/lib/lil-gui/dist/lil-gui.esm.min.js', document.baseURI).href
      }
    };
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

// Where the demo's assets, node_modules and the local dist live, as seen from
// the browser.
//
// The devtools pages need four things the repo lays out in four different
// places, and there is no single root that serves them all — so who serves
// this checkout decides what the URLs look like:
//
//   npm run dev (live-server)    root = demo/,  with /lib → node_modules, /dist → dist
//   a plain static server        root = the repo, so the demo is under /demo/
//
// Rather than pick one and break the other, each root is probed once at module
// load. Everything resolves from THIS file's own URL, so the pages also work
// from a subdirectory (e.g. served at /gcode-preview/devtools/).

const DEVTOOLS = new URL('../', import.meta.url);
// devtools/ sits next to demo/ in the repo, and at the server root when the
// demo itself is the root — so its parent is the one fixed point to probe from.
const PARENT = new URL('../', DEVTOOLS);

async function exists(url) {
  try {
    // HEAD keeps the three.js probe from pulling ~700KB. A server that refuses
    // it (405/501) falls through to the next candidate, which is the same
    // answer the GET would have produced for a path that isn't there.
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

// First candidate that actually holds `probe`; the last one is the fallback, so
// a totally unreachable server still yields usable (if 404ing) URLs.
async function pickRoot(candidates, probe) {
  for (const candidate of candidates.slice(0, -1)) {
    if (await exists(new URL(probe, candidate))) return candidate;
  }
  return candidates[candidates.length - 1];
}

// The demo's own files: style.css, js/presets.js, gcodes/….
export const DEMO_ROOT = await pickRoot([new URL('demo/', PARENT), PARENT], 'js/presets.js');

// three and lil-gui. node_modules first: under a repo-root server it is the
// real thing, while demo/lib holds copies that only npm run copy-deps refreshes.
export const MODULES_ROOT = await pickRoot(
  [new URL('node_modules/', PARENT), new URL('lib/', PARENT)],
  'three/build/three.module.min.js'
);

// The library built from this checkout — dist/ in the repo, and the /dist mount
// under live-server, which are the same directory either way.
export const DIST_ROOT = new URL('dist/', PARENT);

export const demoUrl = (path) => new URL(path, DEMO_ROOT).href;

// The pages hardcode /index.html for "back to demo", which is only right when
// the demo is the server root. Fixing it here means every page gets it without
// six near-identical edits.
function fixDemoLinks() {
  for (const link of document.querySelectorAll('a[href="/index.html"]')) {
    link.href = demoUrl('index.html');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fixDemoLinks);
} else {
  fixDemoLinks();
}

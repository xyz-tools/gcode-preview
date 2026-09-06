// Version-agnostic construction of a preview instance, for runner scripts.
//
//   3.x exports GCodePreview and nests scene bits under preview.sceneManager
//   2.x exports WebGLPreview with everything flat on the preview itself
//
// The returned `scene` object exposes camera, controls, renderer, render(),
// and resize() in both cases.

export async function loadPreview(settings) {
  const module = await import('gcode-preview');
  const Preview = module.GCodePreview ?? module.WebGLPreview;
  if (!Preview) throw new Error('no GCodePreview/WebGLPreview export found');
  const preview = new Preview(settings);
  return { module, preview, scene: preview.sceneManager ?? preview };
}

export const send = (message) => window.parent.postMessage(message, '*');

// Boilerplate for runner scripts: announce readiness, wait for the 'run'
// message, and report errors back to the parent.
export function onRun(run) {
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'run') return;
    Promise.resolve(run(event.data)).catch((error) => {
      console.error(error);
      send({ type: 'error', message: String(error?.message ?? error) });
    });
  });
  send({ type: 'ready' });
}

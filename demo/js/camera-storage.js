// Remembers the demo's camera across page loads. The library leaves camera
// persistence to the app; this is one way to do it.
//
// Every storage access is guarded: reading `localStorage` itself throws when
// site data is blocked, and a stored value may be malformed or come from an
// older version of this file. In all of those cases the demo simply keeps
// the preset's camera.

const STORAGE_KEY = 'gcode-preview-demo:camera';

const isVector3 = (value) =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

export function saveCamera(sceneManager) {
  const { camera, controls } = sceneManager;
  const state = {
    position: camera.position.toArray(),
    target: controls.target.toArray()
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable or full; nothing to remember then
  }
}

/** Applies the saved camera, if any. Returns whether one was applied. */
export function restoreCamera(sceneManager) {
  let state;
  try {
    state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
  if (!isVector3(state?.position) || !isVector3(state?.target)) return false;

  const { camera, controls } = sceneManager;
  camera.position.fromArray(state.position);
  controls.target.fromArray(state.target);
  controls.update();
  return true;
}

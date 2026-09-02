import { describe, it, expect, afterEach, vi } from 'vitest';
import type { GUI } from 'lil-gui';
import { DevGUI } from '../dev-gui';
import { Job } from '../job';
import type { GCodePreview } from '../gcode-preview';

// The real SceneManager needs WebGL, which the test environment does not
// have, so the preview is stubbed with just the properties each panel reads.
function makeSceneManager() {
  return {
    renderer: {
      info: {
        render: { triangles: 0, calls: 0, lines: 0, points: 0 },
        memory: { geometries: 0, textures: 0 }
      }
    },
    lastRenderTime: 0,
    ambientLight: 0.5,
    directionalLight: 1,
    brightness: 1,
    orthographic: false,
    camera: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }
    },
    buildVolume: undefined as { x: number; y: number; z: number } | undefined,
    render: vi.fn(),
    saveCamera: vi.fn(),
    loadCamera: vi.fn(),
    clearCamera: vi.fn()
  };
}

function makePreview(job = new Job(), sceneManager = makeSceneManager()): GCodePreview {
  return {
    sceneManager,
    job,
    parser: { lineCount: 0 },
    clear: vi.fn(),
    dispose: vi.fn()
  } as unknown as GCodePreview;
}

// The DevGUI keeps its lil-gui root private; the tests reach through it to
// drive folders and controllers the way a user would.
function rootOf(devGui: DevGUI): GUI {
  return (devGui as unknown as { gui: GUI }).gui;
}

function folder(devGui: DevGUI, title: string): GUI | undefined {
  return rootOf(devGui)
    .foldersRecursive()
    .find((f) => f._title === title);
}

function controller(devGui: DevGUI, name: string) {
  return rootOf(devGui)
    .controllersRecursive()
    .find((c) => c._name === name);
}

function isClosed(gui: GUI): boolean {
  return gui.domElement.classList.contains('closed');
}

describe('DevGUI', () => {
  afterEach(() => {
    document.querySelectorAll('.lil-gui').forEach((el) => el.remove());
    localStorage.clear();
  });

  it('builds every panel when no options are given, starting collapsed', () => {
    const gui = new DevGUI(makePreview());

    const titles = rootOf(gui)
      .foldersRecursive()
      .map((f) => f._title);
    // No Build Volume folder: the stub scene has no build volume to control.
    // foldersRecursive() is breadth-first, so subfolders come last.
    expect(titles).toEqual(['Render Info', 'Camera', 'Job', 'Dev Helpers', 'Camera position', 'Camera rotation']);
    expect(isClosed(rootOf(gui))).toBe(true);

    gui.destroy();
    expect(document.querySelector('.lil-gui')).toBeNull();
  });

  it('builds the Job panel while the position is still unknown (un-homed)', () => {
    // Regression: state.x/y/z start as undefined since the un-homed position
    // became unknown (#401), and lil-gui cannot build a controller for an
    // undefined value — add() returned undefined and .listen() threw.
    const gui = new DevGUI(makePreview(), { parser: true });

    const labels = Array.from(document.querySelectorAll('.lil-gui .name')).map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['x', 'y', 'z', 'isHomed']));

    gui.destroy();
  });

  it('shows unknown axes as NaN and real coordinates once homed', () => {
    const job = new Job();
    const gui = new DevGUI(makePreview(job), { parser: true });

    const inputs = Array.from(document.querySelectorAll('.lil-gui input[type="text"]')) as HTMLInputElement[];
    const [x] = inputs;
    expect(x.value).toBe('NaN');

    job.state.x = 12.5;
    // listen() only refreshes on animation frames; poke the display directly
    // by re-reading through the controller's live getter.
    gui.reset();
    const refreshed = Array.from(document.querySelectorAll('.lil-gui input[type="text"]')) as HTMLInputElement[];
    expect(refreshed[0].value).toBe('12.5');

    gui.destroy();
  });

  it('writes position edits through to the job state', () => {
    const job = new Job();
    const gui = new DevGUI(makePreview(job), { parser: true });

    controller(gui, 'x')!.setValue(1);
    controller(gui, 'y')!.setValue(2);
    controller(gui, 'z')!.setValue(3);
    expect(job.state.x).toBe(1);
    expect(job.state.y).toBe(2);
    expect(job.state.z).toBe(3);

    gui.destroy();
  });

  it('saves the title of every open folder', () => {
    const sceneManager = makeSceneManager();
    sceneManager.buildVolume = { x: 220, y: 220, z: 250 };
    const gui = new DevGUI(makePreview(new Job(), sceneManager));

    rootOf(gui)
      .foldersRecursive()
      .forEach((f) => f.open());

    expect(JSON.parse(localStorage.getItem('dev-gui-open')!).open).toEqual(
      expect.arrayContaining(['Render Info', 'Camera', 'Job', 'Build Volume', 'Dev Helpers'])
    );

    // Every remembered folder comes back open after a rebuild.
    gui.reset();
    rootOf(gui)
      .foldersRecursive()
      .forEach((f) => expect(isClosed(f)).toBe(false));

    gui.destroy();
  });

  it('remembers which folders were open across rebuilds', () => {
    const gui = new DevGUI(makePreview(), { sceneManager: true, camera: true });

    folder(gui, 'Render Info')!.open();
    // The Camera position/rotation subfolders are always open (DevGUI never
    // closes them), so only the toggled top-level folder matters here.
    const saved = JSON.parse(localStorage.getItem('dev-gui-open')!).open;
    expect(saved).toContain('Render Info');
    expect(saved).not.toContain('Camera');

    gui.reset();
    expect(isClosed(folder(gui, 'Render Info')!)).toBe(false);
    expect(isClosed(folder(gui, 'Camera')!)).toBe(true);

    gui.destroy();
  });

  it('survives a corrupted folder-state entry in localStorage', () => {
    // Regression: JSON.parse threw on a corrupted 'dev-gui-open' entry, which
    // crashed the constructor and with it the whole preview initialization.
    localStorage.setItem('dev-gui-open', 'not-json{');
    const gui = new DevGUI(makePreview(), { parser: true });

    expect(isClosed(folder(gui, 'Job')!)).toBe(true);

    gui.destroy();
  });

  it('rebuilds the GUI when switching camera projection', () => {
    const sceneManager = makeSceneManager();
    const gui = new DevGUI(makePreview(new Job(), sceneManager), { camera: true });
    const oldRoot = rootOf(gui);

    controller(gui, 'Orthographic')!.setValue(true);

    expect(sceneManager.orthographic).toBe(true);
    // reset() replaces the whole lil-gui root and restores the title.
    expect(rootOf(gui)).not.toBe(oldRoot);
    expect(rootOf(gui)._title).toBe('Dev info');

    gui.destroy();
  });

  it('controls the build volume dimensions when one exists', () => {
    const sceneManager = makeSceneManager();
    sceneManager.buildVolume = { x: 220, y: 220, z: 250 };
    const gui = new DevGUI(makePreview(new Job(), sceneManager), { buildVolume: true });

    controller(gui, 'x')!.setValue(300);
    expect(sceneManager.buildVolume.x).toBe(300);

    gui.destroy();
  });

  it('skips the Build Volume panel when the scene has none', () => {
    const gui = new DevGUI(makePreview(), { buildVolume: true });

    expect(rootOf(gui).foldersRecursive()).toEqual([]);

    gui.destroy();
  });

  it('exposes the dev helper actions as buttons', () => {
    const preview = makePreview();
    const gui = new DevGUI(preview, { devHelpers: true });

    for (const name of ['render', 'clear', 'dispose', 'saveCamera', 'loadCamera', 'clearCamera']) {
      (controller(gui, name)!.domElement.querySelector('button') as HTMLButtonElement).click();
    }

    expect(preview.sceneManager.render).toHaveBeenCalledTimes(1);
    expect(preview.clear).toHaveBeenCalledTimes(1);
    expect(preview.dispose).toHaveBeenCalledTimes(1);
    expect(preview.sceneManager.saveCamera).toHaveBeenCalledTimes(1);
    expect(preview.sceneManager.loadCamera).toHaveBeenCalledTimes(1);
    expect(preview.sceneManager.clearCamera).toHaveBeenCalledTimes(1);

    gui.destroy();
  });
});

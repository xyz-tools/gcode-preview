import { describe, it, expect, afterEach } from 'vitest';
import { DevGUI } from '../dev-gui';
import { Job } from '../job';
import type { GCodePreview } from '../gcode-preview';

// A stub is enough for the Job panel: it only reads job.state, job.paths and
// parser.lineCount. The real SceneManager needs WebGL, which the test
// environment does not have.
function makePreview(job = new Job()): GCodePreview {
  return {
    sceneManager: {},
    job,
    parser: { lineCount: 0 }
  } as unknown as GCodePreview;
}

describe('DevGUI', () => {
  afterEach(() => {
    document.querySelectorAll('.lil-gui').forEach((el) => el.remove());
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
});

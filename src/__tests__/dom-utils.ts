import { describe, it, expect, vi } from 'vitest';
import { makeDroppable } from '../extra/dom-utils';
import type { GCodePreview } from '../gcode-preview';

// The real GCodePreview needs WebGL; the drop handling only touches the
// canvas, the job counters and the two methods stubbed here.
function makePreview() {
  const canvas = document.createElement('canvas');
  const received: string[] = [];
  const stub = {
    sceneManager: { canvas, endLayer: 0 },
    job: { layers: [{}, {}, {}], paths: [{}, {}] },
    clear: vi.fn(),
    processGCodeStream: vi.fn(async (stream: ReadableStream<string>) => {
      for await (const chunk of stream) received.push(chunk);
    })
  };
  makeDroppable(stub as unknown as GCodePreview);
  return { canvas, received, stub };
}

// happy-dom has no DragEvent; a plain Event with a dataTransfer property
// bolted on walks and quacks the same for these listeners.
function dragEvent(type: string, dataTransfer?: { files: File[]; dropEffect?: string }): Event {
  const evt = new Event(type);
  if (dataTransfer) Object.assign(evt, { dataTransfer });
  vi.spyOn(evt, 'preventDefault');
  return evt;
}

describe('makeDroppable', () => {
  it('marks the canvas and requests a copy cursor while dragging over', () => {
    const { canvas } = makePreview();
    const dataTransfer = { files: [], dropEffect: 'none' };

    const evt = dragEvent('dragover', dataTransfer);
    canvas.dispatchEvent(evt);

    expect(evt.preventDefault).toHaveBeenCalled();
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(canvas.classList.contains('dragging')).toBe(true);
  });

  it('still marks the canvas when the dragover has no dataTransfer', () => {
    const { canvas } = makePreview();

    canvas.dispatchEvent(dragEvent('dragover'));

    expect(canvas.classList.contains('dragging')).toBe(true);
  });

  it('unmarks the canvas when the drag leaves', () => {
    const { canvas } = makePreview();
    canvas.dispatchEvent(dragEvent('dragover'));

    const evt = dragEvent('dragleave');
    canvas.dispatchEvent(evt);

    expect(evt.preventDefault).toHaveBeenCalled();
    expect(canvas.classList.contains('dragging')).toBe(false);
  });

  it('clears the preview, streams the dropped file and announces the update', async () => {
    const { canvas, received, stub } = makePreview();
    canvas.dispatchEvent(dragEvent('dragover'));
    const file = new File(['G1 X1 Y1\nG1 X2 Y2'], 'benchy.gcode');
    const update = new Promise<CustomEvent>((resolve) => {
      canvas.addEventListener('update', (evt) => resolve(evt as CustomEvent), { once: true });
    });

    canvas.dispatchEvent(dragEvent('drop', { files: [file] }));

    const evt = await update;
    expect(canvas.classList.contains('dragging')).toBe(false);
    expect(stub.clear).toHaveBeenCalledOnce();
    expect(received.join('')).toBe('G1 X1 Y1\nG1 X2 Y2');
    expect(stub.sceneManager.endLayer).toBe(3);
    expect(evt.detail).toEqual({ filename: 'benchy.gcode', size: file.size, layers: 3, paths: 2 });
  });

  it('leaves the scene alone when the drop carries no file', async () => {
    // Regression: dropping anything without a file (plain text, or an empty
    // file list) cleared the scene anyway and then crashed on
    // undefined.stream() in the async listener — an unhandled rejection.
    const { canvas, stub } = makePreview();
    canvas.dispatchEvent(dragEvent('dragover'));

    canvas.dispatchEvent(dragEvent('drop', { files: [] }));
    canvas.dispatchEvent(dragEvent('drop'));
    await vi.waitFor(() => expect(canvas.classList.contains('dragging')).toBe(false));

    expect(stub.clear).not.toHaveBeenCalled();
    expect(stub.processGCodeStream).not.toHaveBeenCalled();
  });
});

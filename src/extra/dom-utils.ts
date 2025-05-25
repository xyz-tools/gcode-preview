import { WebGLPreview } from '../webgl-preview.js';

/**
 * Enables drag and drop handling for G-code files
 */
export function makeDroppable(previewInstance: WebGLPreview): void {
  const element = previewInstance.canvas;

  element.addEventListener('dragover', (evt) => {
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
    element.classList.add('dragging');
  });

  element.addEventListener('dragleave', (evt) => {
    evt.preventDefault();
    element.classList.remove('dragging');
  });

  element.addEventListener('drop', async (evt) => {
    evt.preventDefault();
    element.classList.remove('dragging');
    const files: FileList | [] = evt.dataTransfer?.files ?? [];
    const file = files[0];

    previewInstance.clear(); // TODO: remove?

    await readFromFile(previewInstance, file);
  });
}

/**
 * Reads and processes G-code from a File object
 * @param file - File object containing G-code data
 * @returns Promise that resolves when file processing is complete
 * @emits update - Custom event with file metadata when file ends
 */
async function readFromFile(preview: WebGLPreview, file: File): Promise<void> {
  const stream = file.stream();
  const reader = stream.getReader();
  let result;
  let tail = '';
  let size = 0;

  do {
    result = await reader.read();
    const length = result.value?.length ?? 0;
    if (length === 0) {
      console.debug('stream ended');
      break;
    }
    console.debug('reading from stream', Math.floor(length / 1024), 'kB');
    size += length;
    const str = decode(result.value);
    const idxNewLine = str.lastIndexOf('\n');
    const maxFullLine = str.slice(0, idxNewLine);

    // parse increments but don't render yet
    const { commands } = preview.parser.parseGCode(tail + maxFullLine);

    // we'll execute the commands immediately, for now
    preview.interpreter.execute(commands, preview.job);

    tail = str.slice(idxNewLine);
  } while (!result.done);
  console.debug('total read from stream', Math.floor(size / 1024), 'kB');

  preview.endLayer = preview.job.layers.length;

  // dispatch a custom event to notify that the file has been loaded
  const event = new CustomEvent('update', {
    detail: {
      filename: file.name,
      size: size,
      layers: preview.job.layers.length,
      paths: preview.job.paths.length
    }
  });
  preview.canvas.dispatchEvent(event);

  preview.renderAnimated();
}

function decode(uint8array: Uint8Array) {
  return new TextDecoder('utf-8').decode(uint8array);
}

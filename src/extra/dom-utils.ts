import { GCodePreview } from '../gcode-preview.js';

/**
 * Enables drag and drop handling for G-code files
 */
export function makeDroppable(previewInstance: GCodePreview): void {
  const element = previewInstance.sceneManager.canvas;

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

    await readFile(previewInstance, file);
  });
}

/**
 * Reads and processes G-code from a File object
 * @param file - File object containing G-code data
 * @returns Promise that resolves when file processing is complete
 * @emits update - Custom event with file metadata when file ends
 */
async function readFile(preview: GCodePreview, file: File): Promise<void> {
  await preview.processGCodeStream(file.stream().pipeThrough(new TextDecoderStream()));
  // preview.processGCode ( await file.text() )
  preview.sceneManager.endLayer = preview.job.layers.length;

  // dispatch a custom event to notify that the file has been loaded
  const event = new CustomEvent('update', {
    detail: {
      filename: file.name,
      size: file.size,
      layers: preview.job.layers.length,
      paths: preview.job.paths.length
    }
  });
  preview.sceneManager.canvas.dispatchEvent(event);
}

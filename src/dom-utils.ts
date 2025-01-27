import { WebGLPreview } from './webgl-preview';
/**
 * Enables drag and drop handling for G-code files
 */
export function enableDropHandler(previewInstance: WebGLPreview, element : HTMLElement): void {
  console.warn('Drag and drop is deprecated as a library feature. See the demo how to implement your own.');
  element.addEventListener('dragover', (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
    element.classList.add('dragging');
  });

  element.addEventListener('dragleave', (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
    element.classList.remove('dragging');
  });

  element.addEventListener('drop', async (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
    element.classList.remove('dragging');
    const files: FileList | [] = evt.dataTransfer?.files ?? [];
    const file = files[0];

    this.clear();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.readFromStream(file.stream() );
    this.render();
  });
}
import { type GCodePreviewOptions, WebGLPreview } from './webgl-preview';

import { type DevModeOptions } from './dev-gui';
/**
 * Initializes a new WebGLPreview instance with the given options
 * @param opts - Configuration options for the G-code preview
 * @returns A new WebGLPreview instance
 */
const init = function (opts: GCodePreviewOptions) {
  return new WebGLPreview(opts);
};
/**
 * Main exports for the G-code preview module
 *
 * @remarks
 * This module provides the core functionality for rendering G-code previews in WebGL.
 * It exports the WebGLPreview class, initialization function, and related types.
 */
export { WebGLPreview, init, DevModeOptions, GCodePreviewOptions };

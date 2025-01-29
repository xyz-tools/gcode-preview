import { GUI } from 'lil-gui';
import { WebGLPreview } from './webgl-preview';

/**
 * Configuration options for development mode GUI
 * @property camera - Show camera controls (default: false)
 * @property renderer - Show renderer stats (default: false)
 * @property parser - Show parser/job stats (default: false)
 * @property buildVolume - Show build volume controls (default: false)
 * @property devHelpers - Show development helpers (default: false)
 * @property statsContainer - Container element for stats display
 */
export type DevModeOptions = {
  camera?: boolean | false;
  renderer?: boolean | false;
  parser?: boolean | false;
  buildVolume?: boolean | false;
  devHelpers?: boolean | false;
  statsContainer?: HTMLElement | undefined;
};

/**
 * Development GUI for debugging and monitoring the 3D preview
 */
class DevGUI {
  private gui: GUI;
  private webglPreview;
  private options?: DevModeOptions | undefined;
  private openFolders: string[] = [];

  /**
   * Creates a new DevGUI instance
   * @param watchedObject - The object to monitor and control
   * @param options - Configuration options for the GUI
   */
  constructor(webglPreview: WebGLPreview, options?: DevModeOptions | undefined) {
    this.webglPreview = webglPreview;
    this.options = options;

    this.gui = new GUI();
    this.gui.title('Dev info');

    this.setup();
  }

  /**
   * Sets up the development GUI with all configured panels
   */
  setup(): void {
    this.loadOpenFolders();
    if (!this.options || this.options.renderer) {
      this.setupRendererFolder();
    }

    if (!this.options || this.options.camera) {
      this.setupCameraFolder();
    }

    if (!this.options || this.options.parser) {
      this.setupParserFolder();
    }

    if (!this.options || this.options.buildVolume) {
      this.setupBuildVolumeFolder();
    }

    if (!this.options || this.options.devHelpers) {
      this.setupDevHelpers();
    }
  }

  /**
   * Resets the GUI by destroying and recreating it
   */
  reset(): void {
    this.gui.destroy();
    this.gui = new GUI();
    this.gui.title('Dev info');
    this.setup();
  }

  /**
   * Loads the state of open folders from localStorage
   */
  loadOpenFolders(): void {
    this.openFolders = JSON.parse(localStorage.getItem('dev-gui-open') || '{}').open || [];
  }

  /**
   * Saves the state of open folders to localStorage
   */
  saveOpenFolders(): void {
    this.openFolders = this.gui
      .foldersRecursive()
      .filter((folder) => {
        return !folder._closed;
      })
      .map((folder) => {
        return folder._title;
      });
    localStorage.setItem('dev-gui-open', JSON.stringify({ open: this.openFolders }));
  }

  /**
   * Sets up the renderer stats panel with memory and render call information
   */
  private setupRendererFolder(): void {
    const render = this.gui.addFolder('Render Info');
    if (!this.openFolders.includes('Render Info')) {
      render.close();
    }
    render.onOpenClose(() => {
      this.saveOpenFolders();
    });
    render.add(this.webglPreview.renderer.info.render, 'triangles').listen();
    render.add(this.webglPreview.renderer.info.render, 'calls').listen();
    render.add(this.webglPreview.renderer.info.render, 'lines').listen();
    render.add(this.webglPreview.renderer.info.render, 'points').listen();
    render.add(this.webglPreview.renderer.info.memory, 'geometries').listen();
    render.add(this.webglPreview.renderer.info.memory, 'textures').listen();
    render.add(this.webglPreview, '_lastRenderTime').listen();

    render.add(this.webglPreview, 'ambientLight', 0, 1, 0.01);
    render.add(this.webglPreview, 'directionalLight', 0, 2, 0.1);
    render.add(this.webglPreview, 'brightness', 0, 2, 0.1);
  }

  /**
   * Sets up the camera controls panel with position and rotation controls
   */
  private setupCameraFolder(): void {
    const camera = this.gui.addFolder('Camera');
    if (!this.openFolders.includes('Camera')) {
      camera.close();
    }
    camera.onOpenClose(() => {
      this.saveOpenFolders();
    });
    const cameraPosition = camera.addFolder('Camera position');
    cameraPosition.add(this.webglPreview.camera.position, 'x').listen();
    cameraPosition.add(this.webglPreview.camera.position, 'y').listen();
    cameraPosition.add(this.webglPreview.camera.position, 'z').listen();

    // button to save camera position to local storage
    // cameraPosition.add({
    //   saveCameraPosition: () => {
    //     localStorage.setItem('cameraPosition', JSON.stringify(this.webglPreview.camera.position));
    //   },
    // }, 'saveCameraPosition').name('Save camera position');

    const cameraRotation = camera.addFolder('Camera rotation');
    cameraRotation.add(this.webglPreview.camera.rotation, 'x').listen();
    cameraRotation.add(this.webglPreview.camera.rotation, 'y').listen();
    cameraRotation.add(this.webglPreview.camera.rotation, 'z').listen();
  }

  /**
   * Sets up the parser/job stats panel with path and line count information
   */
  private setupParserFolder(): void {
    const parser = this.gui.addFolder('Job');
    if (!this.openFolders.includes('Job')) {
      parser.close();
    }
    parser.onOpenClose(() => {
      this.saveOpenFolders();
    });
    parser.add(this.webglPreview.job.state, 'x').listen();
    parser.add(this.webglPreview.job.state, 'y').listen();
    parser.add(this.webglPreview.job.state, 'z').listen();
    parser.add(this.webglPreview.job.paths, 'length').name('paths.count').listen();
    parser.add(this.webglPreview.parser.lines, 'length').name('lines.count').listen();
  }

  /**
   * Sets up the build volume controls panel with dimension controls
   */
  private setupBuildVolumeFolder(): void {
    if (!this.webglPreview.buildVolume) {
      return;
    }
    const buildVolume = this.gui.addFolder('Build Volume');
    if (!this.openFolders.includes('Build Volume')) {
      buildVolume.close();
    }
    buildVolume.onOpenClose(() => {
      this.saveOpenFolders();
    });
    buildVolume
      .add(this.webglPreview.buildVolume, 'x')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.webglPreview.render();
      });
    buildVolume
      .add(this.webglPreview.buildVolume, 'y')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.webglPreview.render();
      });
    buildVolume
      .add(this.webglPreview.buildVolume, 'z')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.webglPreview.render();
      });
  }

  /**
   * Sets up the development helpers panel with wireframe and render controls
   */
  private setupDevHelpers(): void {
    const devHelpers = this.gui.addFolder('Dev Helpers');
    if (!this.openFolders.includes('Dev Helpers')) {
      devHelpers.close();
    }
    devHelpers.onOpenClose(() => {
      this.saveOpenFolders();
    });
    devHelpers
      .add(this.webglPreview, '_wireframe')
      .listen()
      .onChange(() => {
        this.webglPreview.render();
      });
    devHelpers.add(this.webglPreview, 'render').listen();
    devHelpers.add(this.webglPreview, 'clear').listen();
  }
}

export { DevGUI };

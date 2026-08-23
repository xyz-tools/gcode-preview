import { GUI } from 'lil-gui';
import { GCodePreview } from './gcode-preview';
import { SceneManager } from './scene-manager';

/**
 * Configuration options for development mode GUI
 * @property camera - Show camera controls (default: false)
 * @property sceneManager - Show sceneManager stats (default: false)
 * @property parser - Show parser/job stats (default: false)
 * @property buildVolume - Show build volume controls (default: false)
 * @property devHelpers - Show development helpers (default: false)
 * @property statsContainer - Container element for stats display
 */
export type DevModeOptions = {
  camera?: boolean | false;
  sceneManager?: boolean | false;
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
  private sceneManager: SceneManager;
  private gcodePreview: GCodePreview;
  private options?: DevModeOptions | undefined;
  private openFolders: string[] = [];

  /**
   * Creates a new DevGUI instance
   * @param watchedObject - The object to monitor and control
   * @param options - Configuration options for the GUI
   */
  constructor(watchedObject: GCodePreview, options?: DevModeOptions | undefined) {
    this.gcodePreview = watchedObject;
    this.sceneManager = this.gcodePreview.sceneManager;
    this.options = options;

    this.gui = new GUI();
    this.gui.title('Dev info');
    this.gui.close(); // start collapsed, so it stays out of the way until it's needed

    this.setup();
  }

  /**
   * Sets up the development GUI with all configured panels
   */
  setup(): void {
    this.loadOpenFolders();
    if (!this.options || this.options.sceneManager) {
      this.setupSceneManagerFolder();
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

  destroy(): void {
    this.gui.destroy();
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
  private setupSceneManagerFolder(): void {
    const render = this.gui.addFolder('Render Info');
    if (!this.openFolders.includes('Render Info')) {
      render.close();
    }
    render.onOpenClose(() => {
      this.saveOpenFolders();
    });
    render.add(this.sceneManager.renderer.info.render, 'triangles').listen();
    render.add(this.sceneManager.renderer.info.render, 'calls').listen();
    render.add(this.sceneManager.renderer.info.render, 'lines').listen();
    render.add(this.sceneManager.renderer.info.render, 'points').listen();
    render.add(this.sceneManager.renderer.info.memory, 'geometries').listen();
    render.add(this.sceneManager.renderer.info.memory, 'textures').listen();
    render.add(this.sceneManager, 'lastRenderTime').listen();

    render.add(this.sceneManager, 'ambientLight', 0, 1, 0.01);
    render.add(this.sceneManager, 'directionalLight', 0, 2, 0.1);
    render.add(this.sceneManager, 'brightness', 0, 2, 0.1);
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
    camera
      .add(this.sceneManager, 'orthographic')
      .name('Orthographic')
      .onChange(() => {
        this.reset();
      });

    const cameraPosition = camera.addFolder('Camera position');
    cameraPosition.add(this.sceneManager.camera.position, 'x').listen();
    cameraPosition.add(this.sceneManager.camera.position, 'y').listen();
    cameraPosition.add(this.sceneManager.camera.position, 'z').listen();

    // button to save camera position to local storage
    // cameraPosition.add({
    //   saveCameraPosition: () => {
    //     localStorage.setItem('cameraPosition', JSON.stringify(this.renderer.camera.position));
    //   },
    // }, 'saveCameraPosition').name('Save camera position');

    const cameraRotation = camera.addFolder('Camera rotation');
    cameraRotation.add(this.sceneManager.camera.rotation, 'x').listen();
    cameraRotation.add(this.sceneManager.camera.rotation, 'y').listen();
    cameraRotation.add(this.sceneManager.camera.rotation, 'z').listen();
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
    parser.add(this.gcodePreview.job.state, 'x').listen();
    parser.add(this.gcodePreview.job.state, 'y').listen();
    parser.add(this.gcodePreview.job.state, 'z').listen();
    parser.add(this.gcodePreview.job.paths, 'length').name('paths.count').listen();
    parser.add(this.gcodePreview.parser, 'lineCount').name('lines.count').listen();
  }

  /**
   * Sets up the build volume controls panel with dimension controls
   */
  private setupBuildVolumeFolder(): void {
    if (!this.sceneManager.buildVolume) {
      return;
    }
    const buildVolume = this.gui.addFolder('Build Volume');
    if (!this.openFolders.includes('Build Volume')) {
      buildVolume.close();
    }
    buildVolume.onOpenClose(() => {
      this.saveOpenFolders();
    });
    buildVolume.add(this.sceneManager.buildVolume, 'x').min(0).max(600).step(10).listen();
    buildVolume.add(this.sceneManager.buildVolume, 'y').min(0).max(600).step(10).listen();
    buildVolume.add(this.sceneManager.buildVolume, 'z').min(0).max(600).step(10).listen();
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
    // devHelpers
    //   .add(this.renderer, '_wireframe')
    //   .listen()
    //   .onChange(() => {
    //     this.renderer.render();
    //   });
    devHelpers.add(this.gcodePreview.sceneManager, 'render').listen();
    devHelpers.add(this.gcodePreview, 'clear').listen();
    devHelpers.add(this.gcodePreview, 'dispose').listen();

    devHelpers.add(this.sceneManager, 'saveCamera').listen();
    devHelpers.add(this.sceneManager, 'loadCamera').listen();
    devHelpers.add(this.sceneManager, 'clearCamera').listen();
  }
}

export { DevGUI };

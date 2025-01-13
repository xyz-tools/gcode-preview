import { GUI } from 'lil-gui';

/**
 * Configuration options for development mode GUI
 */
export type DevModeOptions = {
  /** Show camera controls (default: false) */
  camera?: boolean | false;
  /** Show renderer stats (default: false) */
  renderer?: boolean | false;
  /** Show parser/job stats (default: false) */
  parser?: boolean | false;
  /** Show build volume controls (default: false) */
  buildVolume?: boolean | false;
  /** Show development helpers (default: false) */
  devHelpers?: boolean | false;
  /** Container element for stats display */
  statsContainer?: HTMLElement | undefined;
};

/**
 * Development GUI for debugging and monitoring the 3D preview
 */
class DevGUI {
  private gui: GUI;
  private watchedObject: {
    renderer: {
      info: {
        render: { triangles: number; calls: number; lines: number; points: number };
        memory: { geometries: number; textures: number };
      };
    };
    camera: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
    };
    job: {
      state: { x: number; y: number; z: number };
      paths: { length: number };
    };
    parser: {
      lines: { length: number };
    };
    buildVolume?: {
      x: number;
      y: number;
      z: number;
    };
    _lastRenderTime: number;
    _wireframe: boolean;
    render: () => void;
    clear: () => void;
  };
  private options?: DevModeOptions | undefined;
  private openFolders: string[] = [];

  /**
   * Creates a new DevGUI instance
   * @param watchedObject - The object to monitor and control
   * @param options - Configuration options for the GUI
   */
  constructor(
    watchedObject: {
      renderer: {
        info: {
          render: { triangles: number; calls: number; lines: number; points: number };
          memory: { geometries: number; textures: number };
        };
      };
      camera: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
      };
      job: {
        state: { x: number; y: number; z: number };
        paths: { length: number };
      };
      parser: {
        lines: { length: number };
      };
      buildVolume?: {
        x: number;
        y: number;
        z: number;
      };
      _lastRenderTime: number;
      _wireframe: boolean;
      render: () => void;
      clear: () => void;
    },
    options?: DevModeOptions | undefined
  ) {
    this.watchedObject = watchedObject;
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
    console.log(this.openFolders);
    localStorage.setItem('dev-gui-open', JSON.stringify({ open: this.openFolders }));
  }

  /**
   * Sets up the renderer stats panel
   */
  /**
   * Sets up the renderer stats panel
   */
  private setupRendererFolder(): void {
    const render = this.gui.addFolder('Render Info');
    if (!this.openFolders.includes('Render Info')) {
      render.close();
    }
    render.onOpenClose(() => {
      this.saveOpenFolders();
    });
    render.add(this.watchedObject.renderer.info.render, 'triangles').listen();
    render.add(this.watchedObject.renderer.info.render, 'calls').listen();
    render.add(this.watchedObject.renderer.info.render, 'lines').listen();
    render.add(this.watchedObject.renderer.info.render, 'points').listen();
    render.add(this.watchedObject.renderer.info.memory, 'geometries').listen();
    render.add(this.watchedObject.renderer.info.memory, 'textures').listen();
    render.add(this.watchedObject, '_lastRenderTime').listen();
  }

  /**
   * Sets up the camera controls panel
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
    cameraPosition.add(this.watchedObject.camera.position, 'x').listen();
    cameraPosition.add(this.watchedObject.camera.position, 'y').listen();
    cameraPosition.add(this.watchedObject.camera.position, 'z').listen();

    const cameraRotation = camera.addFolder('Camera rotation');
    cameraRotation.add(this.watchedObject.camera.rotation, 'x').listen();
    cameraRotation.add(this.watchedObject.camera.rotation, 'y').listen();
    cameraRotation.add(this.watchedObject.camera.rotation, 'z').listen();
  }

  /**
   * Sets up the parser/job stats panel
   */
  private setupParserFolder(): void {
    const parser = this.gui.addFolder('Job');
    if (!this.openFolders.includes('Job')) {
      parser.close();
    }
    parser.onOpenClose(() => {
      this.saveOpenFolders();
    });
    parser.add(this.watchedObject.job.state, 'x').listen();
    parser.add(this.watchedObject.job.state, 'y').listen();
    parser.add(this.watchedObject.job.state, 'z').listen();
    parser.add(this.watchedObject.job.paths, 'length').name('paths.count').listen();
    parser.add(this.watchedObject.parser.lines, 'length').name('lines.count').listen();
  }

  /**
   * Sets up the build volume controls panel
   */
  private setupBuildVolumeFolder(): void {
    if (!this.watchedObject.buildVolume) {
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
      .add(this.watchedObject.buildVolume, 'x')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.watchedObject.render();
      });
    buildVolume
      .add(this.watchedObject.buildVolume, 'y')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.watchedObject.render();
      });
    buildVolume
      .add(this.watchedObject.buildVolume, 'z')
      .min(0)
      .max(600)
      .listen()
      .onChange(() => {
        this.watchedObject.render();
      });
  }

  /**
   * Sets up the development helpers panel
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
      .add(this.watchedObject, '_wireframe')
      .listen()
      .onChange(() => {
        this.watchedObject.render();
      });
    devHelpers.add(this.watchedObject, 'render').listen();
    devHelpers.add(this.watchedObject, 'clear').listen();
  }
}

export { DevGUI };

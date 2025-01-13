import { GUI } from 'lil-gui';
import { WebGLPreview } from './webgl-preview';

export type DevModeOptions = {
  camera?: boolean | false;
  renderer?: boolean | false;
  parser?: boolean | false;
  buildVolume?: boolean | false;
  devHelpers?: boolean | false;
  statsContainer?: HTMLElement | undefined;
};

class DevGUI {
  private gui: GUI;
  private webglPreview;
  private options?: DevModeOptions | undefined;
  private openFolders: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(webglPreview: WebGLPreview, options?: DevModeOptions | undefined) {
    this.webglPreview = webglPreview;
    this.options = options;

    this.gui = new GUI();
    this.gui.title('Dev info');

    this.setup();
  }

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

  reset(): void {
    this.gui.destroy();
    this.gui = new GUI();
    this.gui.title('Dev info');
    this.setup();
  }

  loadOpenFolders(): void {
    this.openFolders = JSON.parse(localStorage.getItem('dev-gui-open') || '{}').open || [];
  }

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

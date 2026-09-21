import { createApp, ref, computed, watch, onMounted, watchEffect } from 'vue';
import { presets } from './presets.js';
import { GCodePreview } from 'gcode-preview';
import { defaultSettings } from './default-settings.js';
import { humanFileSize, parseIntOrDefault } from './utils.js';

const defaultPreset = 'benchy'; // default preset to load
const preferDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
const initialBackgroundColor = preferDarkMode.matches ? '#141414' : '#eee';

let observer = null;
let preview = null;

export const app = (window.app = createApp({
  setup() {
    const activeTab = ref('layers');
    const selectedPreset = ref(defaultPreset);
    const thumbnail = ref(null);
    const layerCount = ref(0);
    const fileName = ref(null);
    const fileSize = ref(0);
    const formattedFileSize = computed(() => (fileSize.value ? humanFileSize(fileSize.value) : null));
    const slicerName = ref(null);
    const model = ref(null);
    const settings = ref(Object.assign({}, defaultSettings));

    watch(selectedPreset, (preset) => {
      selectPreset(preset);
    });

    const selectTab = (tab) => (activeTab.value = tab);

    const addColor = () => settings.value.colors.push('#000000'); // TODO: random color

    const removeColor = () => settings.value.colors.pop();

    // Update UI with current preview settings
    const updateUI = async () => {
      console.log('Updating UI');
      const { parser, countLayers, sceneManager } = preview;
      const { thumbnails } = parser.metadata;

      // thumbnail.value = thumbnails['220x124']?.src;
      // get largest thumbnail available
      const thumbnailSizes = Object.keys(thumbnails).map((size) => parseInt(size.split('x')[0]));
      const largestThumbnailSize = Math.max(...thumbnailSizes);
      const largestThumbnailKey = Object.keys(thumbnails).find((key) => key.startsWith(`${largestThumbnailSize}x`));
      thumbnail.value = thumbnails[largestThumbnailKey]?.src;

      layerCount.value = countLayers;
      slicerName.value = parser.metadata.slicerName ?? null;
      sceneManager.endLayer = countLayers;

      const currentSettings = {
        maxLayer: countLayers || 1000,
        endLayer: countLayers
      };

      Object.assign(settings.value, currentSettings);
    };

    const loadGCodeFromServer = async (filename) => {
      const response = await fetch(filename);
      if (response.status !== 200) {
        console.error('ERROR. Status Code: ' + response.status);
        return;
      }

      fileName.value = filename.split('/').pop();
      // the stream is consumed by the parser, so the size has to come from the
      // response header; it stays unknown (and hidden) if the server omits it
      fileSize.value = parseIntOrDefault(response.headers.get('content-length'));

      // drop the previous job before streaming in the new one, otherwise
      // processGCodeStream appends to the existing job and doubles memory
      preview.clear();

      const gcodeStream = response.body.pipeThrough(new TextDecoderStream());

      await preview.processGCodeStream(gcodeStream); // rendering will be done reactively
      updateUI();
    };

    const selectPreset = async (presetName) => {
      preview.clear();
      const preset = presets[presetName];
      model.value = preset.model;

      const options = {
        ...defaultSettings,
        ...preset
      };
      if (options.initialCameraPosition) {
        preview.sceneManager.camera.position.fromArray(options.initialCameraPosition);
      }
      // re-aim the camera at the preset's plate center; the preview instance is
      // reused across presets, so the constructor's centering never re-runs
      const buildVolume = options.buildVolume;
      if (buildVolume) {
        preview.sceneManager.controls.target.set(buildVolume.x / 2, 0, -buildVolume.y / 2);
      } else {
        preview.sceneManager.controls.target.set(100, 0, -100);
      }
      preview.sceneManager.controls.update();

      console.debug('Applying preset', presetName, options);

      Object.assign(settings.value, options);

      loadGCodeFromServer(preset.file);
    };

    onMounted(async () => {
      const canvas = document.querySelector('canvas.preview');

      window['_preview'] = preview = new GCodePreview({
        ...defaultSettings,
        canvas: canvas,
        droppable: true,
        backgroundColor: initialBackgroundColor
      });

      // resize preview on canvas resize (TODO: move to GCodePreview)
      if (observer) observer.disconnect();
      observer = new ResizeObserver(() => preview.sceneManager.resize());
      observer.observe(canvas);

      // dropped files report their own name and size via this event
      canvas.addEventListener('update', (evt) => {
        fileName.value = evt.detail.filename;
        fileSize.value = evt.detail.size;
      });

      // to update the layer count and the thumbnail when available
      preview.onJobUpdated = () => updateUI();
      preview.onStreamEnd = () => updateUI();

      watchEffect(() => {
        preview.sceneManager.backgroundColor = settings.value.backgroundColor;

        if (preview.sceneManager.buildVolume && settings.value.drawBuildVolume) {
          preview.sceneManager.buildVolume.smallGrid = settings.value.buildVolume.smallGrid;
          preview.sceneManager.buildVolume.x = +settings.value.buildVolume.x;
          preview.sceneManager.buildVolume.y = +settings.value.buildVolume.y;
          preview.sceneManager.buildVolume.z = +settings.value.buildVolume.z;
        }

        if (!preview.sceneManager.buildVolume && settings.value.drawBuildVolume) {
          preview.sceneManager.buildVolume = {
            x: +settings.value.buildVolume.x,
            y: +settings.value.buildVolume.y,
            z: +settings.value.buildVolume.z,
            smallGrid: settings.value.buildVolume.smallGrid
          };
        } else if (preview.sceneManager.buildVolume && !settings.value.drawBuildVolume) {
          preview.sceneManager.buildVolume = undefined;
        }
        preview.sceneManager.boundingBoxColor = settings.value.drawBoundingBox
          ? settings.value.boundingBoxColor
          : undefined;
      });

      watchEffect(() => {
        preview.sceneManager.renderTravel = settings.value.renderTravel;
        preview.sceneManager.travelColor = settings.value.travelColor;
        preview.sceneManager.lineWidth = +settings.value.lineWidth;

        preview.sceneManager.renderExtrusion = settings.value.renderExtrusion;
        preview.sceneManager.renderTubes = settings.value.renderTubes;
        preview.sceneManager.disableGradient = settings.value.disableGradient;
        preview.sceneManager.extrusionWidth = +settings.value.extrusionWidth;

        preview.sceneManager.topLayerColor = settings.value.highlightTopLayer
          ? settings.value.topLayerColor
          : undefined;
        preview.sceneManager.lastSegmentColor = settings.value.highlightLastSegment
          ? settings.value.lastSegmentColor
          : undefined;
      });

      watchEffect(() => {
        const startLayer = parseIntOrDefault(settings.value.startLayer, undefined);
        const endLayer = parseIntOrDefault(settings.value.endLayer, undefined);

        preview.sceneManager.startLayer = settings.value.enableStartLayer ? startLayer : undefined;
        preview.sceneManager.endLayer = settings.value.enableEndLayer ? endLayer : undefined;
      });

      watchEffect(() => {
        preview.sceneManager.singleLayerMode = settings.value.singleLayerMode;
      });

      watchEffect(() => {
        if (!preview) return;
        preview.sceneManager.orthographic = settings.value.orthographic;
      });

      watchEffect(() => {
        if (!preview) return;
        preview.sceneManager.extrusionColor =
          settings.value.colors.length === 1 ? settings.value.colors[0] : settings.value.colors;
      });

      selectPreset(defaultPreset);
    });

    return {
      presets,
      activeTab,
      selectedPreset,
      thumbnail,
      layerCount,
      fileName,
      fileSize,
      formattedFileSize,
      slicerName,
      model,
      settings,
      selectTab,
      addColor,
      removeColor,
      resetUI: updateUI,
      loadGCodeFromServer,
      selectPreset
    };
  }
}).mount('#app'));

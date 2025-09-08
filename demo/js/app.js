import { createApp, ref, watch, onMounted, watchEffect } from 'vue';
import { presets } from './presets.js';
import { GCodePreview } from 'gcode-preview';
import { defaultSettings } from './default-settings.js';
import { parseIntOrDefault } from './utils.js';

const defaultPreset = 'benchy'; // default preset to load
const preferDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
const initialBackgroundColor = preferDarkMode.matches ? '#141414' : '#eee';
const statsContainer = () => document.querySelector('.sidebar');

const loadProgressive = ref(true);
let observer = null;
let preview = null;

export const app = (window.app = createApp({
  setup() {
    const activeTab = ref('layers');
    const selectedPreset = ref(defaultPreset);
    const thumbnail = ref(null);
    const layerCount = ref(0);
    const fileSize = ref(0);
    const model = ref(null);
    const dragging = ref(false);
    const settings = ref(Object.assign({}, defaultSettings));
    const drawBoundingBox = ref(false);
    const enableDevMode = ref(false);

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
      sceneManager.endLayer = countLayers;

      const currentSettings = {
        maxLayer: countLayers || 1000,
        endLayer: countLayers
      };

      Object.assign(settings.value, currentSettings);

      applyDevMode(enableDevMode.value);
    };

    const loadGCodeFromServer = async (filename) => {
      const response = await fetch(filename);
      if (response.status !== 200) {
        console.error('ERROR. Status Code: ' + response.status);
        return;
      }

      const gcodeStream = response.body.pipeThrough(new TextDecoderStream());

      const prevDevMode = preview.devMode;
      preview.devMode = prevDevMode;

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

      console.debug('Applying preset', presetName, options);

      Object.assign(settings.value, options);

      // reset previous state
      const lilGuiElement = document.querySelector('.lil-gui');
      if (lilGuiElement) document.body.removeChild(lilGuiElement);
      const stats = document.querySelector('.stats');
      if (stats) stats.parentNode.removeChild(stats);
      if (defaultSettings.devMode) defaultSettings.devMode.statsContainer = statsContainer();

      loadGCodeFromServer(preset.file);
    };

    function applyDevMode(enabled) {
      // these elements will be recreated when changing presets, so we'll look them up dynamically
      document.querySelectorAll('.lil-gui, .stats').forEach((el) => (el.style.display = enabled ? 'block' : 'none'));
    }

    watch(enableDevMode, applyDevMode);

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

      // to update the layer count and the thumbnail when available
      preview.addEventListener(['jobUpdated', 'streamReadEnd'], () => {
        updateUI();
      });

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
      fileSize,
      model,
      dragging,
      settings,
      loadProgressive,
      drawBoundingBox,
      enableDevMode,
      selectTab,
      addColor,
      removeColor,
      resetUI: updateUI,
      loadGCodeFromServer,
      selectPreset
    };
  }
}).mount('#app'));

import { createApp, ref, watch, onMounted, watchEffect } from 'vue';
import { presets } from './presets.js';
import * as GCodePreview from 'gcode-preview';
import { defaultSettings } from './default-settings.js';
import { parseIntOrDefault } from './utils.js';

const defaultPreset = 'easel'; // default preset to load
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
    const enableDevMode = ref(false);
    const drawBoundingBox = ref(false);

    watch(selectedPreset, (preset) => {
      selectPreset(preset);
    });

    const selectTab = (tab) => (activeTab.value = tab);

    const addColor = () => settings.value.colors.push('#000000'); // TODO: random color

    const removeColor = () => settings.value.colors.pop();

    const update = async (evt) => {
      model.value = {
        name: evt.detail.filename
      };
      applyDevMode(enableDevMode.value); // HACK: force dev mode to update UI
      updateUI();
    };

    // Update UI with current preview settings
    const updateUI = async () => {
      const {
        parser,
        countLayers,
        extrusionColor,
        topLayerColor,
        lastSegmentColor,
        buildVolume,
        backgroundColor,
        singleLayerMode,
        renderTravel,
        travelColor,
        renderExtrusion,
        lineWidth,
        renderTubes,
        extrusionWidth,
        boundingBoxColor
      } = preview;
      const { thumbnails } = parser.metadata;

      // thumbnail.value = thumbnails['220x124']?.src;
      // get largest thumbnail available
      const thumbnailSizes = Object.keys(thumbnails).map((size) => parseInt(size.split('x')[0]));
      const largestThumbnailSize = Math.max(...thumbnailSizes);
      const largestThumbnailKey = Object.keys(thumbnails).find((key) => key.startsWith(`${largestThumbnailSize}x`));
      thumbnail.value = thumbnails[largestThumbnailKey]?.src;

      layerCount.value = countLayers;
      const colors = extrusionColor instanceof Array ? extrusionColor : [extrusionColor];
      const currentSettings = {
        startLayer: 1,
        enableStartLayer: false,
        maxLayer: countLayers || 1000,
        endLayer: countLayers,
        enableEndLayer: false,
        singleLayerMode,
        renderTravel,
        travelColor: '#' + travelColor.getHexString(),
        renderExtrusion,
        lineWidth,
        renderTubes,
        extrusionWidth,
        colors: colors.map((c) => '#' + c.getHexString()),
        topLayerColor: '#' + topLayerColor?.getHexString(),
        highlightTopLayer: !!topLayerColor,
        lastSegmentColor: '#' + lastSegmentColor?.getHexString(),
        highlightLastSegment: !!lastSegmentColor,
        buildVolume: buildVolume,
        drawBuildVolume: !!buildVolume,
        backgroundColor: '#' + backgroundColor.getHexString(),
        boundingBoxColor
      };
      // console.debug('Current settings:', currentSettings);
      Object.assign(settings.value, currentSettings);
      preview.endLayer = countLayers;

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
      // preview.clear();
      preview.devMode = prevDevMode;

      await preview.processGCode(gcodeStream, { render: false }); // rendering will be done reactively
    };

    const render = async () => {
      if (loadProgressive.value && preview.job.layers !== null) {
        await preview.renderAnimated();
      } else {
        preview.render();
      }
    };

    const selectPreset = async (presetName) => {
      const canvas = document.querySelector('canvas.preview');
      const preset = presets[presetName];
      model.value = preset.model;

      // cascade settings: first defaults, then apply the preset, finally some overrides
      const options = {
        ...defaultSettings,
        ...preset,
        canvas,
        droppable: true,
        backgroundColor: initialBackgroundColor
      };

      // reset previous state
      const lilGuiElement = document.querySelector('.lil-gui');
      if (lilGuiElement) document.body.removeChild(lilGuiElement);
      const stats = document.querySelector('.stats');
      if (stats) stats.parentNode.removeChild(stats);
      if (defaultSettings.devMode) defaultSettings.devMode.statsContainer = statsContainer();
      preview?.dispose();

      window['_preview'] = preview = new GCodePreview.init(options);

      // resize preview on canvas resize (TODO: move to GCodePreview)
      if (observer) observer.disconnect();
      observer = new ResizeObserver(() => preview.resize());
      observer.observe(canvas);

      applyDevMode(enableDevMode.value); // HACK: force dev mode to update UI

      await loadGCodeFromServer(preset.file);
      applyDevMode(enableDevMode.value);

      updateUI();
    };

    function applyDevMode(enabled) {
      // these elements will be recreated when changing presets, so we'll look them up dynamically
      document.querySelectorAll('.lil-gui, .stats').forEach((el) => (el.style.display = enabled ? 'block' : 'none'));
    }
    watch(enableDevMode, applyDevMode);

    onMounted(async () => {
      await selectPreset(defaultPreset);

      watchEffect(() => {
        preview.backgroundColor = settings.value.backgroundColor;

        if (preview.buildVolume && settings.value.drawBuildVolume) {
          preview.buildVolume.smallGrid = settings.value.buildVolume.smallGrid;
          preview.buildVolume.x = +settings.value.buildVolume.x;
          preview.buildVolume.y = +settings.value.buildVolume.y;
          preview.buildVolume.z = +settings.value.buildVolume.z;
        }

        if (!preview.buildVolume && settings.value.drawBuildVolume) {
          preview.buildVolume = {
            x: +settings.value.buildVolume.x,
            y: +settings.value.buildVolume.y,
            z: +settings.value.buildVolume.z,
            smallGrid: settings.value.buildVolume.smallGrid
          };
        } else if (preview.buildVolume && !settings.value.drawBuildVolume) {
          preview.buildVolume = undefined;
        }
        preview.boundingBoxColor = drawBoundingBox.value ? (settings.value.boundingBoxColor ?? 'magenta') : undefined;
      });

      watchEffect(() => {
        preview.renderTravel = settings.value.renderTravel;
        preview.travelColor = settings.value.travelColor;
        preview.lineWidth = +settings.value.lineWidth;

        preview.renderExtrusion = settings.value.renderExtrusion;
        preview.renderTubes = settings.value.renderTubes;
        preview.extrusionWidth = +settings.value.extrusionWidth;

        preview.topLayerColor = settings.value.highlightTopLayer ? settings.value.topLayerColor : undefined;
        preview.lastSegmentColor = settings.value.highlightLastSegment ? settings.value.lastSegmentColor : undefined;

        // run render after settings have been applied
        // this is needed to prevent reactivity attaching the render function
        setTimeout(() => {
          render();
        }, 0);
      });

      watchEffect(() => {
        const startLayer = parseIntOrDefault(settings.value.startLayer, undefined);
        const endLayer = parseIntOrDefault(settings.value.endLayer, undefined);
        console.debug('watchEffect: startLayer', startLayer);

        preview.startLayer = settings.value.enableStartLayer ? startLayer : undefined;
        preview.endLayer = settings.value.enableEndLayer ? endLayer : undefined;
      });

      watchEffect(() => {
        preview.singleLayerMode = settings.value.singleLayerMode;
      });

      watchEffect(() => {
        preview.extrusionColor = settings.value.colors.length === 1 ? settings.value.colors[0] : settings.value.colors;
      });
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
      enableDevMode,
      drawBoundingBox,
      selectTab,
      addColor,
      removeColor,
      update,
      resetUI: updateUI,
      loadGCodeFromServer,
      selectPreset
    };
  }
}).mount('#app'));

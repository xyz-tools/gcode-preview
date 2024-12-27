import { createApp, ref, watch, onMounted, watchEffect } from 'vue';
import { presets } from './presets.js';
import * as GCodePreview from 'gcode-preview';
import { defaultSettings } from './default-settings.js';
import { debounce, humanFileSize, readFile } from './utils.js';

const defaultPreset = 'multicolor';
const preferDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
const initialBackgroundColor = preferDarkMode.matches ? '#141414' : '#eee';
const statsContainer = () => document.querySelector('.sidebar');

const loadProgressive = true;
let observer = null;
let preview = null;

export const app = (window.app = createApp({
  setup() {
    const activeTab = ref('layers');
    const selectedPreset = ref(defaultPreset);
    const thumbnail = ref(null);
    const layerCount = ref(0);
    const fileSize = ref(0);
    const fileName = ref('');
    const dragging = ref(false);
    const settings = ref(Object.assign({}, defaultSettings));
    const enableDevMode = ref(false);

    watch(selectedPreset, (preset) => {
      selectPreset(preset);
    });

    const selectTab = (tab) => (activeTab.value = tab);

    const addColor = () => settings.value.colors.push('#000000'); // TODO: random color

    const removeColor = () => settings.value.colors.pop();

    const dragOver = (event) => {
      event.dataTransfer.dropEffect = 'copy';
      dragging.value = true;
    };

    const dragLeave = () => (dragging.value = false);

    const drop = (event) => {
      dragging.value = false;
      const file = event.dataTransfer.files[0];
      fileName.value = file.name;
      loadDroppedFile(file);
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
        extrusionWidth
      } = preview;
      const { thumbnails } = parser.metadata;

      thumbnail.value = thumbnails['220x124']?.src;
      layerCount.value = countLayers;
      const colors = extrusionColor instanceof Array ? extrusionColor : [extrusionColor];
      const currentSettings = {
        maxLayer: countLayers,
        endLayer: countLayers,
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
        backgroundColor: '#' + backgroundColor.getHexString()
      };

      Object.assign(settings.value, currentSettings);
      preview.endLayer = countLayers;
    };

    const loadGCodeFromServer = async (filename) => {
      const response = await fetch(filename);
      if (response.status !== 200) {
        console.error('ERROR. Status Code: ' + response.status);
        return;
      }

      const gcode = await response.text();
      fileSize.value = humanFileSize(gcode.length);
      startLoadingProgressive(gcode);
    };

    const startLoadingProgressive = async (gcode) => {
      const prevDevMode = preview.devMode;
      preview.clear();
      preview.devMode = prevDevMode;
      const { commands } = preview.parser.parseGCode(gcode);
      preview.interpreter.execute(commands, preview.job);

      render();
    };

    const render = async () => {
      debounce(async () => {
        if (loadProgressive) {
          if (preview.job.layers === null) {
            console.warn('Job is not planar');
            preview.render();
            return;
          }
          await preview.renderAnimated(2000);
        } else {
          preview.render();
        }
      });
    };

    const loadDroppedFile = async (file) => {
      fileSize.value = humanFileSize(file.size);
      const content = await readFile(file);
      applyDevMode(enableDevMode.value); // HACK
      startLoadingProgressive(content);
      applyDevMode(enableDevMode.value);
      updateUI();
    };

    const selectPreset = async (presetName) => {
      const canvas = document.querySelector('canvas.preview');
      const preset = presets[presetName];
      fileName.value = preset.file.replace(/^.*?\//, '');
      const options = Object.assign(
        {
          canvas,
          backgroundColor: initialBackgroundColor
        },
        defaultSettings,
        preset
      );

      // reset previous state
      const lilGuiElement = document.querySelector('.lil-gui');
      if (lilGuiElement) document.body.removeChild(lilGuiElement);
      const stats = document.querySelector('.stats');
      if (stats) stats.parentNode.removeChild(stats);
      if (defaultSettings.devMode) defaultSettings.devMode.statsContainer = statsContainer();
      preview?.dispose();

      preview = new GCodePreview.init(options);

      // resize preview on canvas resize (TODO: move to GCodePreview)
      if (observer) observer.disconnect();
      observer = new ResizeObserver(() => preview.resize());
      observer.observe(canvas);

      applyDevMode(enableDevMode.value);

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
      });

      watchEffect(() => {
        preview.buildVolume = settings.value.drawBuildVolume ? settings.value.buildVolume : undefined;
        preview.buildVolume.x = +settings.value.buildVolume.x;
        preview.buildVolume.y = +settings.value.buildVolume.y;
        preview.buildVolume.z = +settings.value.buildVolume.z;

        preview.renderTravel = settings.value.renderTravel;
        preview.travelColor = settings.value.travelColor;
        preview.lineWidth = +settings.value.lineWidth;

        preview.renderExtrusion = settings.value.renderExtrusion;
        preview.renderTubes = settings.value.renderTubes;
        preview.extrusionWidth = +settings.value.extrusionWidth;
        preview.extrusionColor = settings.value.colors.length === 1 ? settings.value.colors[0] : settings.value.colors;

        // TODO: should be a quick update:
        preview.topLayerColor = settings.value.highlightTopLayer ? settings.value.topLayerColor : undefined;
        preview.lastSegmentColor = settings.value.highlightLastSegment ? settings.value.lastSegmentColor : undefined;

        render();
      });

      watchEffect(() => {
        preview.startLayer = +settings.value.startLayer;
        preview.endLayer = +settings.value.endLayer;
      });

      watchEffect(() => {
        preview.singleLayerMode = settings.value.singleLayerMode;
      });
    });

    return {
      presets,
      activeTab,
      selectedPreset,
      thumbnail,
      layerCount,
      fileSize,
      fileName,
      dragging,
      settings,
      enableDevMode,
      selectTab,
      addColor,
      removeColor,
      dragOver,
      dragLeave,
      drop,
      resetUI: updateUI,
      loadGCodeFromServer,
      startLoadingProgressive,
      loadDroppedFile,
      selectPreset
    };
  }
}).mount('#app'));

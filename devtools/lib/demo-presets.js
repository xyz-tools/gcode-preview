// Bridges the demo's preset catalog into the devtools pages. Served alongside
// the demo (the demo is the server root), so its data is one import away.

import { presets } from '/js/presets.js';
import { defaultSettings } from '/js/default-settings.js';

// Defaults that affect what geometry gets built and where the camera sits,
// pulled from the demo's defaultSettings. Deliberately a small allowlist: the
// demo's defaults also carry app-only keys (endLayer: 1, devMode, …) that
// would break rendering if fed to the GCodePreview constructor.
const DEFAULT_SETTING_KEYS = [
  'buildVolume',
  'initialCameraPosition',
  'lineWidth',
  'lineHeight',
  'extrusionWidth',
  'minLayerThreshold',
  'renderExtrusion',
  'renderTravel',
  'travelColor'
];

// Preset keys that are demo-app metadata, not constructor settings.
const NON_SETTING_PRESET_KEYS = ['title', 'file', 'model'];

export function populatePresetSelect(select, defaultKey) {
  for (const [key, preset] of Object.entries(presets)) {
    if (!preset.file) continue;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.title ?? key;
    select.appendChild(option);
  }
  if (defaultKey) select.value = defaultKey;
}

// Preset files are demo-root-relative ('gcodes/…') or absolute URLs.
export function presetFileUrl(key) {
  const file = presets[key].file;
  return /^https?:\/\//.test(file) ? file : `/${file}`;
}

// defaults base ← FULL preset (minus app metadata) ← explicit overrides.
// The whole preset rides along so per-preset colors, topLayerColor,
// renderTubes, drawBoundingBox, … reach the preview like they do in the demo.
export function presetSettings(key, overrides = {}) {
  const preset = presets[key];
  const settings = { backgroundColor: '#141414' };
  for (const settingKey of DEFAULT_SETTING_KEYS) {
    const value = defaultSettings[settingKey];
    if (value !== undefined) settings[settingKey] = value;
  }
  for (const [presetKey, value] of Object.entries(preset)) {
    if (NON_SETTING_PRESET_KEYS.includes(presetKey)) continue;
    if (value !== undefined) settings[presetKey] = value;
  }
  // The demo's `colors` list is not a constructor option — it maps to the
  // library's `extrusionColor` (a single color when there's one entry, the
  // array for multi-tool presets), exactly like the demo's own binding.
  if (Array.isArray(settings.colors)) {
    settings.extrusionColor = settings.colors.length === 1 ? settings.colors[0] : settings.colors;
    delete settings.colors;
  }
  return { ...settings, ...overrides };
}

export async function fetchPresetGcode(key) {
  const url = presetFileUrl(key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  return response.text();
}

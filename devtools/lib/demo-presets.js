// Bridges the demo's preset catalog into the devtools pages. Served alongside
// the demo (the demo is the server root), so its data is one import away.

import { presets } from '/js/presets.js';
import { defaultSettings } from '/js/default-settings.js';

// Preset keys that affect what geometry gets built and where the camera sits.
// Merged from defaultSettings + the selected preset, like the demo does.
const DISPLAY_SETTING_KEYS = [
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

export function presetSettings(key, overrides = {}) {
  const preset = presets[key];
  const settings = { backgroundColor: '#141414', ...overrides };
  for (const settingKey of DISPLAY_SETTING_KEYS) {
    if (settingKey in overrides) continue;
    const value = preset[settingKey] ?? defaultSettings[settingKey];
    if (value !== undefined) settings[settingKey] = value;
  }
  return settings;
}

export async function fetchPresetGcode(key) {
  const url = presetFileUrl(key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  return response.text();
}

import { clearPresetStateOnFileDrop } from '../../demo/js/utils.js';

describe('demo drop state', () => {
  test('clears preset-derived state when a file is dropped', () => {
    const state = {
      selectedPreset: { value: 'benchy' },
      model: { value: { name: '3DBenchy' } },
      thumbnail: { value: 'data:image/png;base64,benchy' }
    };

    clearPresetStateOnFileDrop(
      {
        dataTransfer: { files: [{}] }
      },
      state
    );

    expect(state.selectedPreset.value).toBeNull();
    expect(state.model.value).toBeNull();
    expect(state.thumbnail.value).toBeNull();
  });

  test('keeps preset-derived state when the drop contains no files', () => {
    const state = {
      selectedPreset: { value: 'benchy' },
      model: { value: { name: '3DBenchy' } },
      thumbnail: { value: 'data:image/png;base64,benchy' }
    };

    clearPresetStateOnFileDrop({ dataTransfer: { files: [] } }, state);

    expect(state.selectedPreset.value).toBe('benchy');
    expect(state.model.value).toEqual({ name: '3DBenchy' });
    expect(state.thumbnail.value).toBe('data:image/png;base64,benchy');
  });
});

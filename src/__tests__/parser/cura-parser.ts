import { test, expect } from 'vitest';
import { CuraMetadataParser } from '../../parser/cura-parser';
import { GCodeCommand } from '../../parser/gcode-parser';

function createCommand(src: string, comment?: string, params = {}): GCodeCommand {
  return new GCodeCommand(src, 'g1', params, comment);
}

test('Cura parser can identify Cura gcode by LAYER comments', () => {
  const parser = new CuraMetadataParser();

  const commands = [createCommand(';LAYER:0', 'LAYER:0'), createCommand('G1 X0 Y0')];

  expect(parser.canParse(commands)).toBe(true);
});

test('Cura parser can identify Cura gcode by generator comment', () => {
  const parser = new CuraMetadataParser();

  const commands = [
    createCommand(';Generated with Cura_SteamEngine 5.0', 'Generated with Cura_SteamEngine 5.0'),
    createCommand('G1 X0 Y0')
  ];

  expect(parser.canParse(commands)).toBe(true);
});

test('Cura parser rejects non-Cura gcode', () => {
  const parser = new CuraMetadataParser();

  const commands = [createCommand(';LAYER_CHANGE', 'LAYER_CHANGE'), createCommand('G1 X0 Y0')];

  expect(parser.canParse(commands)).toBe(false);
});

test('Cura parser extracts single layer metadata', () => {
  const parser = new CuraMetadataParser();

  const commands = [createCommand(';LAYER:0', 'LAYER:0'), createCommand('G1 X0 Y0 Z0.3 E1', undefined, { z: 0.3 })];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(1);
  expect(layers[0]).toEqual({
    layerIndex: 0,
    z: 0.3,
    lineIndex: 0
  });
});

test('Cura parser extracts multiple layer metadata with height calculation', () => {
  const parser = new CuraMetadataParser();

  const commands = [
    createCommand(';LAYER:0', 'LAYER:0'),
    createCommand('G1 X0 Y0 Z0.3 E1', undefined, { z: 0.3 }),
    createCommand(';LAYER:1', 'LAYER:1'),
    createCommand('G1 X10 Y10 Z0.6 E2', undefined, { z: 0.6 })
  ];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(2);
  expect(layers[0]).toEqual({
    layerIndex: 0,
    z: 0.3,
    lineIndex: 0
  });
  expect(layers[1]).toEqual({
    layerIndex: 1,
    z: 0.6,
    height: 0.3, // calculated from previous layer
    lineIndex: 2
  });
});

test('Cura parser handles missing Z values in subsequent commands', () => {
  const parser = new CuraMetadataParser();

  const commands = [
    createCommand(';LAYER:0', 'LAYER:0'),
    createCommand('G1 X0 Y0'),
    createCommand('G1 X5 Y5'),
    createCommand('G1 X10 Y10')
  ];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(1);
  expect(layers[0]).toEqual({
    layerIndex: 0,
    lineIndex: 0
  });
});

test('Cura parser finds Z value within lookahead window', () => {
  const parser = new CuraMetadataParser();

  const commands = [
    createCommand(';LAYER:0', 'LAYER:0'),
    createCommand('G1 X0 Y0'),
    createCommand('G1 X5 Y5'),
    createCommand('G1 X10 Y10'),
    createCommand('G1 X15 Y15 Z0.3 E1', undefined, { z: 0.3 })
  ];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(1);
  expect(layers[0]).toEqual({
    layerIndex: 0,
    z: 0.3,
    lineIndex: 0
  });
});

test('Cura parser handles non-sequential layer numbers', () => {
  const parser = new CuraMetadataParser();

  const commands = [
    createCommand(';LAYER:5', 'LAYER:5'),
    createCommand('G1 X0 Y0 Z1.5 E1', undefined, { z: 1.5 }),
    createCommand(';LAYER:10', 'LAYER:10'),
    createCommand('G1 X10 Y10 Z3.0 E2', undefined, { z: 3.0 })
  ];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(2);
  expect(layers[0]).toEqual({
    layerIndex: 5,
    z: 1.5,
    lineIndex: 0
  });
  expect(layers[1]).toEqual({
    layerIndex: 10,
    z: 3.0,
    height: 1.5, // calculated from previous layer
    lineIndex: 2
  });
});

test('Cura parser returns empty array when no LAYER comments found', () => {
  const parser = new CuraMetadataParser();

  const commands = [createCommand('G1 X0 Y0'), createCommand('G1 X10 Y10')];

  const layers = parser.parseLayerMetadata(commands);

  expect(layers).toHaveLength(0);
});

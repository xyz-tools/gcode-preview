import { describe, it, expect } from 'vitest';
import { GCodeCommand } from '../../parser/gcode-parser';
import { SlicerMetadataParser, LayerMetadata } from '../../parser/metadata-parser-base';

// Minimal concrete parser: exercises the base-class behavior (canParse
// sampling, the default detectSlicerName) without any override shadowing it.
class StubMetadataParser extends SlicerMetadataParser {
  readonly slicerName = 'Stub';
  readonly identificationPatterns = [/^STUB_MARKER/];

  parseLayerMetadata(): LayerMetadata[] {
    return [];
  }
}

function comment(text: string): GCodeCommand {
  return new GCodeCommand(`;${text}`, '', {}, text);
}

describe('SlicerMetadataParser base class', () => {
  it('canParse matches an identification pattern in the sample', () => {
    const parser = new StubMetadataParser();

    expect(parser.canParse([comment('STUB_MARKER v1')])).toBe(true);
    expect(parser.canParse([comment('some other slicer')])).toBe(false);
    expect(parser.canParse([])).toBe(false);
  });

  it('canParse only samples the first maxLines comments', () => {
    const parser = new StubMetadataParser();
    const filler = Array.from({ length: 250 }, (_, i) => comment(`filler ${i}`));

    // Marker beyond the sampling window is not seen...
    expect(parser.canParse([...filler, comment('STUB_MARKER v1')])).toBe(false);
    // ...but within a widened window it is.
    expect(parser.canParse([...filler, comment('STUB_MARKER v1')], 300)).toBe(true);
  });

  it('detectSlicerName defaults to the parser slicerName', () => {
    const parser = new StubMetadataParser();

    expect(parser.detectSlicerName([comment('STUB_MARKER v1')])).toBe('Stub');
  });
});

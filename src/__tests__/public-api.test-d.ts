/**
 * Public API surface pins (type-level half).
 *
 * Checked by the vitest typecheck pass (enabled in vitest.config.mts), so
 * these assertions run as part of `npm test` and CI. They pin the *types* a
 * 3.x consumer compiles against: option-object fields, method signatures and
 * setter assignability. The runtime half lives in `public-api.ts`.
 *
 * The typecheck pass compiles with tsconfig.typecheck.json (strict mode),
 * because expect-type assertions silently pass without strictNullChecks.
 * Expected types below are therefore written with explicit `undefined`/`null`
 * members, matching what a strict-mode consumer sees.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { ColorRepresentation } from 'three';

import type {
  GCodePreview,
  SceneManager,
  Parser,
  GCodeCommand,
  Job,
  GCodePreviewOptions,
  SceneManagerOptions,
  DevModeOptions
} from '../gcode-preview';
import {
  GCodePreview as GCodePreviewClass,
  SceneManager as SceneManagerClass,
  Parser as ParserClass,
  GCodeCommand as GCodeCommandClass,
  Job as JobClass
} from '../gcode-preview';

describe('public API types', () => {
  describe('GCodePreviewOptions', () => {
    it('has exactly the documented option keys', () => {
      expectTypeOf<keyof GCodePreviewOptions>().toEqualTypeOf<
        // LibOptions
        | 'devMode'
        | 'minLayerThreshold'
        | 'droppable'
        | 'keepLines'
        // SceneManagerOptions
        | 'buildVolume'
        | 'backgroundColor'
        | 'canvas'
        | 'endLayer'
        | 'extrusionColor'
        | 'initialCameraPosition'
        | 'lastSegmentColor' // no-op today — debated in #356
        | 'lineWidth'
        | 'lineHeight'
        | 'renderExtrusion'
        | 'renderTravel'
        | 'startLayer'
        | 'topLayerColor' // no-op today — debated in #356
        | 'travelColor'
        | 'disableGradient' // no-op today — debated in #356
        | 'extrusionWidth'
        | 'renderTubes'
        | 'boundingBoxColor'
        | 'orthographic'
      >();
    });

    it('keeps the documented option field types', () => {
      expectTypeOf<GCodePreviewOptions['devMode']>().toEqualTypeOf<boolean | DevModeOptions | undefined>();
      expectTypeOf<GCodePreviewOptions['minLayerThreshold']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['droppable']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<GCodePreviewOptions['keepLines']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<GCodePreviewOptions['canvas']>().toEqualTypeOf<HTMLCanvasElement | undefined>();
      expectTypeOf<GCodePreviewOptions['backgroundColor']>().toEqualTypeOf<ColorRepresentation | undefined>();
      expectTypeOf<GCodePreviewOptions['extrusionColor']>().toEqualTypeOf<
        ColorRepresentation | ColorRepresentation[] | undefined
      >();
      expectTypeOf<GCodePreviewOptions['travelColor']>().toEqualTypeOf<ColorRepresentation | undefined>();
      // topLayerColor, lastSegmentColor and disableGradient are accepted and
      // stored but never read by the render path today. Whether they are
      // re-implemented or removed for 3.0 is debated in #356 — if removed,
      // drop every pin marked "#356" as part of that breaking change.
      expectTypeOf<GCodePreviewOptions['topLayerColor']>().toEqualTypeOf<ColorRepresentation | undefined>();
      expectTypeOf<GCodePreviewOptions['lastSegmentColor']>().toEqualTypeOf<ColorRepresentation | undefined>();
      expectTypeOf<GCodePreviewOptions['boundingBoxColor']>().toEqualTypeOf<ColorRepresentation | undefined>();
      expectTypeOf<GCodePreviewOptions['initialCameraPosition']>().toEqualTypeOf<number[] | undefined>();
      expectTypeOf<GCodePreviewOptions['lineWidth']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['lineHeight']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['extrusionWidth']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['startLayer']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['endLayer']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodePreviewOptions['renderExtrusion']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<GCodePreviewOptions['renderTravel']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<GCodePreviewOptions['renderTubes']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<GCodePreviewOptions['disableGradient']>().toEqualTypeOf<boolean | undefined>(); // debated in #356
      expectTypeOf<GCodePreviewOptions['orthographic']>().toEqualTypeOf<boolean | undefined>();
    });

    it('keeps the buildVolume shape', () => {
      expectTypeOf<keyof NonNullable<GCodePreviewOptions['buildVolume']>>().toEqualTypeOf<
        'x' | 'y' | 'z' | 'smallGrid'
      >();
      expectTypeOf<NonNullable<GCodePreviewOptions['buildVolume']>['x']>().toEqualTypeOf<number>();
      expectTypeOf<NonNullable<GCodePreviewOptions['buildVolume']>['y']>().toEqualTypeOf<number>();
      expectTypeOf<NonNullable<GCodePreviewOptions['buildVolume']>['z']>().toEqualTypeOf<number>();
      expectTypeOf<NonNullable<GCodePreviewOptions['buildVolume']>['smallGrid']>().toEqualTypeOf<boolean | undefined>();
    });

    it('SceneManagerOptions is the scene subset of GCodePreviewOptions', () => {
      expectTypeOf<keyof SceneManagerOptions>().toEqualTypeOf<
        | 'buildVolume'
        | 'backgroundColor'
        | 'canvas'
        | 'endLayer'
        | 'extrusionColor'
        | 'initialCameraPosition'
        | 'lastSegmentColor' // no-op today — debated in #356
        | 'lineWidth'
        | 'lineHeight'
        | 'minLayerThreshold'
        | 'renderExtrusion'
        | 'renderTravel'
        | 'startLayer'
        | 'topLayerColor' // no-op today — debated in #356
        | 'travelColor'
        | 'disableGradient' // no-op today — debated in #356
        | 'extrusionWidth'
        | 'renderTubes'
        | 'boundingBoxColor'
        | 'orthographic'
      >();
    });
  });

  describe('DevModeOptions', () => {
    it('has exactly the documented keys and field types', () => {
      expectTypeOf<keyof DevModeOptions>().toEqualTypeOf<
        'camera' | 'sceneManager' | 'parser' | 'buildVolume' | 'devHelpers' | 'statsContainer'
      >();
      expectTypeOf<DevModeOptions['camera']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<DevModeOptions['sceneManager']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<DevModeOptions['parser']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<DevModeOptions['buildVolume']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<DevModeOptions['devHelpers']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<DevModeOptions['statsContainer']>().toEqualTypeOf<HTMLElement | undefined>();
    });
  });

  describe('GCodePreview', () => {
    it('is constructed from GCodePreviewOptions', () => {
      expectTypeOf<ConstructorParameters<typeof GCodePreviewClass>>().toEqualTypeOf<[GCodePreviewOptions]>();
    });

    it('keeps its public properties and accessors', () => {
      expectTypeOf<GCodePreview['job']>().toEqualTypeOf<Job>();
      expectTypeOf<GCodePreview['sceneManager']>().toEqualTypeOf<SceneManager>();
      expectTypeOf<GCodePreview['parser']>().toEqualTypeOf<Parser>();
      expectTypeOf<GCodePreview['countLayers']>().toEqualTypeOf<number>();
      expectTypeOf<GCodePreview['devMode']>().toEqualTypeOf<boolean | DevModeOptions | undefined>();
      expectTypeOf<GCodePreview['onJobUpdated']>().toEqualTypeOf<((job: Job) => void) | undefined>();
      expectTypeOf<GCodePreview['onStreamEnd']>().toEqualTypeOf<(() => void) | undefined>();
    });

    it('keeps its public method signatures', () => {
      expectTypeOf<GCodePreview['clear']>().toEqualTypeOf<() => void>();
      expectTypeOf<GCodePreview['dispose']>().toEqualTypeOf<() => void>();
      expectTypeOf<GCodePreview['processGCode']>().toEqualTypeOf<(gcode: string | string[]) => Promise<void>>();
      expectTypeOf<GCodePreview['processGCodeStream']>().toEqualTypeOf<
        (gcode: string | string[] | ReadableStream, options?: { render?: boolean }) => Promise<void>
      >();
      expectTypeOf<GCodePreview['readStream']>().toEqualTypeOf<(stream: ReadableStream) => Promise<void>>();
    });
  });

  describe('SceneManager', () => {
    it('is constructed from SceneManagerOptions and a Job', () => {
      expectTypeOf<ConstructorParameters<typeof SceneManagerClass>>().toEqualTypeOf<[SceneManagerOptions, Job]>();
    });

    it('keeps its public method signatures', () => {
      expectTypeOf<SceneManager['job']>().toEqualTypeOf<Job>();
      expectTypeOf<SceneManager['canvas']>().toEqualTypeOf<HTMLCanvasElement>();
      expectTypeOf<SceneManager['render']>().toEqualTypeOf<() => void>();
      expectTypeOf<SceneManager['renderAnimated']>().toEqualTypeOf<(pathCount?: number) => Promise<void>>();
      expectTypeOf<SceneManager['dispose']>().toEqualTypeOf<() => void>();
      expectTypeOf<SceneManager['resize']>().toEqualTypeOf<() => void>();
      expectTypeOf<SceneManager['clear']>().toEqualTypeOf<() => void>();
    });

    it('keeps setter assignability for consumers', () => {
      // A compile-only contract: each assignment below must keep compiling
      // for 3.x consumers. The function is never called.
      const setterContract = (sm: SceneManager): void => {
        sm.extrusionColor = 'hotpink';
        sm.extrusionColor = 0xff00ff;
        sm.extrusionColor = ['#ff0000', '#00ff00'];
        sm.backgroundColor = '#000000';
        sm.travelColor = 0x123456;
        sm.topLayerColor = 'red'; // no-op today — debated in #356
        sm.lastSegmentColor = 'red'; // no-op today — debated in #356
        sm.boundingBoxColor = 'red';
        sm.buildVolume = { x: 200, y: 200, z: 200, smallGrid: undefined };
        sm.lineWidth = 2;
        sm.lineHeight = 0.2;
        sm.extrusionWidth = 0.4;
        sm.startLayer = 1;
        sm.endLayer = 10;
        sm.singleLayerMode = true;
        sm.renderExtrusion = true;
        sm.renderTravel = false;
        sm.renderTubes = true;
        sm.disableGradient = false; // no-op today — debated in #356
        sm.brightness = 1;
        sm.orthographic = false;
      };
      expectTypeOf(setterContract).toBeFunction();
    });
  });

  describe('Parser', () => {
    it('is constructed from optional parser options', () => {
      expectTypeOf<ConstructorParameters<typeof ParserClass>>().toEqualTypeOf<[{ keepLines?: boolean }?]>();
    });

    it('keeps its public fields and method signatures', () => {
      expectTypeOf<Parser['lines']>().toEqualTypeOf<string[]>();
      expectTypeOf<Parser['lineCount']>().toEqualTypeOf<number>();
      expectTypeOf<keyof Parser['metadata']>().toEqualTypeOf<'thumbnails'>();
      expectTypeOf<Parameters<Parser['parseGCode']>>().toEqualTypeOf<[string | string[]]>();
      expectTypeOf<keyof ReturnType<Parser['parseGCode']>>().toEqualTypeOf<'metadata' | 'commands'>();
      expectTypeOf<ReturnType<Parser['parseGCode']>['commands']>().toEqualTypeOf<GCodeCommand[]>();
      expectTypeOf<Parameters<Parser['parseCommand']>>().toEqualTypeOf<[string, boolean?]>();
      expectTypeOf<ReturnType<Parser['parseCommand']>>().toEqualTypeOf<GCodeCommand | null>();
    });
  });

  describe('GCodeCommand', () => {
    it('keeps its public fields', () => {
      expectTypeOf<GCodeCommand['src']>().toEqualTypeOf<string>();
      expectTypeOf<GCodeCommand['gcode']>().toEqualTypeOf<string>();
      expectTypeOf<GCodeCommand['comment']>().toEqualTypeOf<string | undefined>();
      // Well-known G-code parameters plus the open index signature.
      expectTypeOf<GCodeCommand['params']['x']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodeCommand['params']['e']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodeCommand['params']['f']>().toEqualTypeOf<number | undefined>();
      expectTypeOf<GCodeCommand['params']['customWord']>().toEqualTypeOf<number | undefined>();
    });

    it('is constructed from src, gcode, params and optional comment', () => {
      expectTypeOf<ConstructorParameters<typeof GCodeCommandClass>>().toEqualTypeOf<
        [string, string, GCodeCommand['params'], string?]
      >();
    });
  });

  describe('Job', () => {
    it('is constructed from optional state and layer threshold', () => {
      expectTypeOf<ConstructorParameters<typeof JobClass>>().toEqualTypeOf<
        [{ state?: Job['state']; minLayerThreshold?: number }?]
      >();
    });

    it('keeps its public fields, getters and method signatures', () => {
      expectTypeOf<Job['countLayers']>().toEqualTypeOf<number>();
      expectTypeOf<Job['isPlanar']>().toEqualTypeOf<boolean>();
      expectTypeOf<Job['extrusions']>().toEqualTypeOf<Job['paths']>();
      expectTypeOf<Job['travels']>().toEqualTypeOf<Job['paths']>();
      expectTypeOf<Job['toolPaths']>().toEqualTypeOf<Job['paths'][]>();
      expectTypeOf<Job['inprogressPath']>().toEqualTypeOf<Job['paths'][number] | undefined>();
      expectTypeOf<Job['addPath']>().toEqualTypeOf<(path: Job['paths'][number]) => void>();
      expectTypeOf<Job['finishPath']>().toEqualTypeOf<() => void>();
      expectTypeOf<Job['resumeLastPath']>().toEqualTypeOf<() => void>();
    });
  });
});

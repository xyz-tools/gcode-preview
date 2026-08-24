/**
 * Public API surface pins (runtime half).
 *
 * This file spells out the library's public contract: every named export,
 * every public method, accessor and constructor arity a 3.x consumer can
 * rely on. If a change lands here unintentionally, it is a breaking change.
 * If it is intentional, update the manifest below in the same PR and call
 * the change out in the release notes.
 *
 * The type-level half of the contract (options-object fields, method
 * signatures, setter assignability) lives in `public-api.test-d.ts`.
 */
import { describe, it, expect } from 'vitest';
import { Color } from 'three';

import * as api from '../gcode-preview';
import { GCodePreview, SceneManager, Parser, GCodeCommand, Job } from '../gcode-preview';
import packageJson from '../../package.json';

/** Names of prototype members that are plain methods. */
function methodNames(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function'
  );
}

/** Names of prototype members that have a getter. */
function getterNames(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter((name) => Object.getOwnPropertyDescriptor(proto, name)?.get);
}

/** Names of prototype members that have a setter. */
function setterNames(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter((name) => Object.getOwnPropertyDescriptor(proto, name)?.set);
}

describe('public API surface', () => {
  describe('package entry points', () => {
    it('points main and types at the bundled build', () => {
      expect(packageJson.main).toBe('dist/gcode-preview.es.js');
      expect(packageJson.types).toBe('dist/gcode-preview.d.ts');
      expect(packageJson.files).toEqual(['dist']);
    });
  });

  describe('module exports', () => {
    it('exposes exactly the documented runtime exports', () => {
      // Type-only exports (GCodePreviewOptions, SceneManagerOptions,
      // DevModeOptions) are erased at runtime and pinned in the .test-d file.
      expect(Object.keys(api).sort()).toEqual(['GCodeCommand', 'GCodePreview', 'Job', 'Parser', 'SceneManager']);
    });

    it('has no default export', () => {
      expect((api as { default?: unknown }).default).toBeUndefined();
    });
  });

  describe('GCodePreview', () => {
    it('takes a single required options argument', () => {
      expect(GCodePreview.length).toBe(1);
    });

    // name -> arity of required parameters
    const methods: Record<string, number> = {
      clear: 0,
      processGCode: 1,
      processGCodeStream: 1,
      readStream: 1,
      dispose: 0
    };

    it.each(Object.entries(methods))('has method %s with %d required parameter(s)', (name, arity) => {
      const method = Object.getOwnPropertyDescriptor(GCodePreview.prototype, name)?.value;
      expect(typeof method).toBe('function');
      expect(method).toHaveLength(arity);
    });

    it.each(['sceneManager', 'parser', 'countLayers', 'devMode'])('has getter %s', (name) => {
      expect(getterNames(GCodePreview.prototype)).toContain(name);
    });

    it('has setter devMode', () => {
      expect(setterNames(GCodePreview.prototype)).toContain('devMode');
    });
  });

  describe('SceneManager', () => {
    it('takes options and a job', () => {
      expect(SceneManager.length).toBe(2);
    });

    it('exposes the default extrusion color as a static Color', () => {
      expect(SceneManager.defaultExtrusionColor).toBeInstanceOf(Color);
    });

    const methods: Record<string, number> = {
      updateClippingPlanes: 0,
      animate: 0,
      render: 0,
      renderAnimated: 0,
      renderProgressive: 0,
      clear: 0,
      resize: 0,
      dispose: 0,
      saveCamera: 0,
      loadCamera: 0,
      clearCamera: 0
    };

    it.each(Object.entries(methods))('has method %s with %d required parameter(s)', (name, arity) => {
      const method = Object.getOwnPropertyDescriptor(SceneManager.prototype, name)?.value;
      expect(typeof method).toBe('function');
      expect(method).toHaveLength(arity);
    });

    // Every accessor a consumer can both read and assign.
    const accessors = [
      'buildVolume',
      'extrusionColor',
      'backgroundColor',
      'travelColor',
      'topLayerColor',
      'lastSegmentColor',
      'boundingBoxColor',
      'startLayer',
      'endLayer',
      'singleLayerMode',
      'renderExtrusion',
      'renderTravel',
      'renderTubes',
      'lineWidth',
      'lineHeight',
      'extrusionWidth',
      'disableGradient',
      'ambientLight',
      'directionalLight',
      'brightness',
      'orthographic'
    ];

    it.each(accessors)('has getter and setter %s', (name) => {
      expect(getterNames(SceneManager.prototype)).toContain(name);
      expect(setterNames(SceneManager.prototype)).toContain(name);
    });

    // Read-only since #380 moved the bounding box into the ObjectsManager.
    it('has read-only getter boundingBoxMesh', () => {
      expect(getterNames(SceneManager.prototype)).toContain('boundingBoxMesh');
    });
  });

  describe('Parser', () => {
    it('takes an optional options argument', () => {
      expect(Parser.length).toBe(0);
    });

    const methods: Record<string, number> = {
      parseGCode: 1,
      parseCommand: 1,
      parseMetadata: 1
    };

    it.each(Object.entries(methods))('has method %s with %d required parameter(s)', (name, arity) => {
      const method = Object.getOwnPropertyDescriptor(Parser.prototype, name)?.value;
      expect(typeof method).toBe('function');
      expect(method).toHaveLength(arity);
    });

    it('starts with empty metadata, lines and lineCount', () => {
      const parser = new Parser();
      expect(parser.metadata).toEqual({ thumbnails: {} });
      expect(parser.lines).toEqual([]);
      expect(parser.lineCount).toBe(0);
    });

    it('parses a command into the documented shape', () => {
      const { metadata, commands } = new Parser().parseGCode('G1 X10 Y20 ; hello');
      expect(metadata).toEqual({ thumbnails: {} });
      expect(commands).toHaveLength(1);
      expect(commands[0]).toBeInstanceOf(GCodeCommand);
      expect(commands[0].gcode).toBe('g1');
      expect(commands[0].params.x).toBe(10);
      expect(commands[0].params.y).toBe(20);
    });
  });

  describe('GCodeCommand', () => {
    it('takes src, gcode, params and an optional comment', () => {
      expect(GCodeCommand.length).toBe(4);
    });

    it('exposes its constructor arguments as public fields', () => {
      const command = new GCodeCommand('G1 X1 ; up', 'g1', { x: 1 }, 'up');
      expect(command.src).toBe('G1 X1 ; up');
      expect(command.gcode).toBe('g1');
      expect(command.params).toEqual({ x: 1 });
      expect(command.comment).toBe('up');
    });
  });

  describe('Job', () => {
    it('takes an optional options argument', () => {
      expect(Job.length).toBe(0);
    });

    const methods: Record<string, number> = {
      addPath: 1,
      finishPath: 0,
      resumeLastPath: 0
    };

    it.each(Object.entries(methods))('has method %s with %d required parameter(s)', (name, arity) => {
      const method = Object.getOwnPropertyDescriptor(Job.prototype, name)?.value;
      expect(typeof method).toBe('function');
      expect(method).toHaveLength(arity);
    });

    it.each(['extrusions', 'travels', 'toolPaths', 'layers', 'isPlanar', 'countLayers'])('has getter %s', (name) => {
      expect(getterNames(Job.prototype)).toContain(name);
    });

    it('starts with empty public state', () => {
      const job = new Job();
      expect(job.paths).toEqual([]);
      expect(job.state).toBeDefined();
      expect(job.boundingBox).toBeDefined();
      expect(job.inprogressPath).toBeUndefined();
    });
  });

  describe('no unexpected public surface shrinkage', () => {
    // Guards against accidentally converting public members to #private
    // (which removes them from the prototype entirely).
    it('keeps GCodePreview prototype members visible', () => {
      expect(methodNames(GCodePreview.prototype).length).toBeGreaterThanOrEqual(5);
    });

    it('keeps SceneManager prototype members visible', () => {
      expect(methodNames(SceneManager.prototype).length).toBeGreaterThanOrEqual(10);
    });
  });
});

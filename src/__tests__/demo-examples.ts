/**
 * Conformance checks for the standalone example pages in `demo/examples`.
 *
 * Each page holds its example as inert text (`<script type="text/plain">`)
 * that `runner.js` shows in an editor and runs in an iframe, so nothing else
 * type-checks or bundles it: a renamed option or method would leave the page
 * silently broken until someone opened it. These checks read each page and pin
 * what it actually references against the real source:
 *
 * - the importmap paths that make the pages work both under `npm run dev`
 *   (live-server mounts `/dist` and `/lib`) and on the deployed demo
 *   (`predeploy` copies the same files into `demo/dist` and `demo/lib`);
 * - every named import from `gcode-preview`;
 * - every `preview.*` and `preview.sceneManager.*` member touched;
 * - every constructor option key, including the `buildVolume` fields;
 * - every local G-code file fetched;
 * - that the page is still wired to the runner, and that the index links it.
 *
 * If a check fails because the library changed on purpose, update the examples
 * in the same PR.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as api from '../gcode-preview';
import { GCodePreview, SceneManager } from '../gcode-preview';
import packageJson from '../../package.json';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplesDir = join(root, 'demo', 'examples');

const INDEX = 'index.html';
// The bundle lists the package's dependencies as externals, so a page has to
// map every one of them — `lil-gui` included, even with devMode off, because
// the import is static.
const IMPORTMAP = {
  three: '../lib/three/build/three.module.min.js',
  'lil-gui': '../lib/lil-gui/dist/lil-gui.esm.min.js',
  'gcode-preview': '../dist/gcode-preview.es.js'
};

const exampleFiles = readdirSync(examplesDir)
  .filter((file) => file.endsWith('.html') && file !== INDEX)
  .sort();

/** Strips `//` line comments so commented-out code is not mistaken for usage. */
function stripLineComments(source: string): string {
  return source.replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The example's own code, as the runner hands it to the iframe, comments removed. */
function exampleCode(html: string): string {
  const match = html.match(/<script type="text\/plain" id="code">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no example code block found');

  return stripLineComments(match[1]);
}

/** The page's importmap, parsed. */
function importMap(html: string): { imports: Record<string, string> } {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no importmap found');

  return JSON.parse(match[1]);
}

/** The source of the object literal starting at `from`, brace-matched. */
function objectLiteralAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1);
  }
  throw new Error('unbalanced object literal');
}

/** Keys declared directly in an object literal, ignoring nested ones. */
function topLevelKeys(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (const match of literal.matchAll(/[{}[\]]|(\w+)\s*:/g)) {
    if (match[0] === '{' || match[0] === '[') depth++;
    else if (match[0] === '}' || match[0] === ']') depth--;
    else if (depth === 1 && match[1]) keys.push(match[1]);
  }

  return keys;
}

/** The options object passed to `new GCodePreview(...)`, or undefined. */
function constructorOptions(script: string): string | undefined {
  const start = script.indexOf('new GCodePreview(');
  if (start === -1) return undefined;

  return objectLiteralAt(script, script.indexOf('{', start));
}

/** Optional field names declared in a `type X = { ... }` block of a source file. */
function declaredOptionKeys(file: string, typeName: string): string[] {
  const source = readFileSync(join(root, 'src', file), 'utf8');
  const start = source.indexOf(`type ${typeName} = {`);
  expect(start, `${typeName} not found in src/${file}`).toBeGreaterThan(-1);

  const block = objectLiteralAt(source, source.indexOf('{', start));

  return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]);
}

/** Public (non-private) member names declared on the class in a source file. */
function declaredClassMembers(file: string, className: string): string[] {
  const source = readFileSync(join(root, 'src', file), 'utf8');
  const start = source.indexOf(`export class ${className}`);
  expect(start, `${className} not found in src/${file}`).toBeGreaterThan(-1);

  const body = source.slice(start);

  return [...body.matchAll(/^ {2}(?!private |static |\/)(?:get |set )?(\w+)[?(:]/gm)].map((match) => match[1]);
}

/** Every member name reachable on a prototype chain up to Object. */
function prototypeMembers(proto: object | null): string[] {
  const names: string[] = [];
  while (proto && proto !== Object.prototype) {
    names.push(...Object.getOwnPropertyNames(proto));
    proto = Object.getPrototypeOf(proto);
  }

  return names;
}

const previewMembers = new Set([
  ...prototypeMembers(GCodePreview.prototype),
  ...declaredClassMembers('gcode-preview.ts', 'GCodePreview')
]);
const sceneManagerMembers = new Set([
  ...prototypeMembers(SceneManager.prototype),
  ...declaredClassMembers('scene-manager.ts', 'SceneManager')
]);
const optionKeys = new Set([
  ...declaredOptionKeys('gcode-preview.ts', 'LibOptions'),
  ...declaredOptionKeys('scene-manager.ts', 'SceneManagerOptions')
]);
const buildVolumeKeys = new Set(declaredOptionKeys('build-volume.ts', 'BuildVolumeDef'));

describe('demo examples', () => {
  it('ships at least one example, an index page and the runner', () => {
    expect(exampleFiles.length).toBeGreaterThan(0);
    for (const file of [INDEX, 'runner.js', 'runner.css']) {
      expect(existsSync(join(examplesDir, file)), `${file} is missing`).toBe(true);
    }
  });

  it('links every example from the index page', () => {
    const index = readFileSync(join(examplesDir, INDEX), 'utf8');

    for (const file of exampleFiles) {
      expect(index, `${file} is not linked from ${INDEX}`).toContain(`href="${file}"`);
    }
  });

  describe.each(exampleFiles)('%s', (file) => {
    const html = readFileSync(join(examplesDir, file), 'utf8');
    const script = exampleCode(html);

    it('resolves three.js and the library through the shared importmap', () => {
      expect(importMap(html).imports).toMatchObject(IMPORTMAP);
    });

    it('maps every external the bundle imports', () => {
      const mapped = Object.keys(importMap(html).imports);

      for (const dependency of Object.keys(packageJson.dependencies)) {
        expect(mapped, `${dependency} is an external but is not in the importmap`).toContain(dependency);
      }
    });

    it('imports nothing but bare specifiers from the importmap', () => {
      const specifiers = [...script.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

      // The code in the editor is what someone copies, so it may not reach for
      // a helper module of its own: only the library and its externals.
      expect(specifiers.every((specifier) => specifier in IMPORTMAP)).toBe(true);
      expect(html).not.toContain('unpkg.com');
      expect(html).not.toContain('cdn.jsdelivr.net');
    });

    it('lets the runner drive it: editable code, an output template, a Run button', () => {
      expect(html).toContain('<script type="module" src="runner.js"></script>');
      expect(html, 'the runner fills this from the code block').toContain('<textarea');
      expect(html, 'the runner builds the iframe document from this').toContain('<template id="output">');
      expect(html).toContain('id="run"');
    });

    it('imports only names the library exports', () => {
      const imported = [...script.matchAll(/import\s*\{([^}]+)\}\s*from '([^']+)'/g)]
        .filter((match) => match[2] === 'gcode-preview')
        .flatMap((match) => match[1].split(','))
        .map((name) => name.trim());

      expect(imported.length).toBeGreaterThan(0);
      for (const name of imported) {
        expect(api, `gcode-preview does not export ${name}`).toHaveProperty(name);
      }
    });

    it('touches only real members of GCodePreview', () => {
      for (const [, member] of script.matchAll(/(?<![\w.-])preview\.(\w+)/g)) {
        if (member === 'sceneManager') continue;
        expect(previewMembers.has(member), `GCodePreview has no member ${member}`).toBe(true);
      }
    });

    it('touches only real members of SceneManager', () => {
      for (const [, member] of script.matchAll(/(?<![\w.-])sceneManager\.(\w+)/g)) {
        expect(sceneManagerMembers.has(member), `SceneManager has no member ${member}`).toBe(true);
      }
    });

    it('passes only real constructor options', () => {
      const options = constructorOptions(script);
      // Not every example renders: the parser one never builds a preview.
      if (options === undefined) {
        expect(script).not.toContain('new GCodePreview');
        return;
      }

      for (const key of topLevelKeys(options)) {
        expect(optionKeys.has(key), `GCodePreviewOptions has no key ${key}`).toBe(true);
      }
    });

    it('passes only real buildVolume fields', () => {
      const options = constructorOptions(script);
      const start = options?.indexOf('buildVolume:') ?? -1;
      if (options === undefined || start === -1) return;

      for (const key of topLevelKeys(objectLiteralAt(options, options.indexOf('{', start)))) {
        expect(buildVolumeKeys.has(key), `BuildVolumeDef has no field ${key}`).toBe(true);
      }
    });

    it('fetches only G-code files that exist', () => {
      for (const [, path] of script.matchAll(/'\.\.\/(gcodes\/[^']+)'/g)) {
        expect(existsSync(join(root, 'demo', path)), `demo/${path} is missing`).toBe(true);
      }
    });
  });
});

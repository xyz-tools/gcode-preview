/* eslint-env node */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import configs from '../rolldown.config.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const consumer = mkdtempSync(join(tmpdir(), 'gcode-preview-packaging-'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const log = join(consumer, 'packaging.log');

function run(command, args, cwd = consumer) {
  console.log(`Packaging: ${command} ${args.join(' ')}`);
  try {
    const output = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(log, output, { flag: 'a' });
    return output;
  } catch (error) {
    writeFileSync(log, `${error.stdout}\n${error.stderr}`, { flag: 'a' });
    throw error;
  }
}

try {
  // Exercise sharing before the standalone parser becomes a public entry point (#492).
  for (const { output, ...config } of configs) {
    // The declaration pass lets rolldown-plugin-dts name its own chunks, so the
    // expected extension comes from the plugin list rather than entryFileNames.
    const plugins = config.plugins.flat().filter((plugin) => plugin.name !== 'clean-dist');
    const extension = plugins.some((plugin) => plugin.name.startsWith('rolldown-plugin-dts')) ? '.d.ts' : '.js';
    console.log(`Packaging: verify shared ${extension} chunks`);
    const bundle = await rolldown({
      ...config,
      input: { ...config.input, parser: 'src/parser/gcode-parser.ts' },
      plugins
    });
    try {
      const { output: chunks } = await bundle.generate(output);
      // The declaration pass resolves the parser to its generated .d.ts module.
      const source = join(root, `src/parser/gcode-parser${extension === '.d.ts' ? '.d.ts' : '.ts'}`);
      const owners = chunks.filter((chunk) => chunk.type === 'chunk' && source in chunk.modules);
      assert.equal(owners.length, 1, 'parser implementation must not be duplicated');
      assert(
        chunks.some((chunk) => chunk.type === 'chunk' && chunk.imports.includes(owners[0].fileName)),
        'the preview entry must reuse the parser chunk'
      );
      assert.equal(chunks.filter((chunk) => chunk.type === 'chunk' && chunk.isEntry).length, 2);
      assert(owners[0].fileName.endsWith(extension));
    } finally {
      await bundle.close();
    }
  }
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', consumer], root));
  assert(!packed.files.some(({ path }) => path === 'dist/gcode-preview.js'), 'UMD build must not ship');
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(consumer, packed.filename)]);
  writeFileSync(
    join(consumer, 'smoke.mjs'),
    `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { GCodePreview, Parser, Job, SceneManager } from 'gcode-preview';
const require = createRequire(import.meta.url);
const pkg = require('gcode-preview/package.json');
assert.equal(pkg.type, 'module');
assert.equal(pkg.sideEffects, false);
assert.equal(pkg.dependencies['lil-gui'], undefined);
assert.equal(typeof GCodePreview, 'function');
assert.equal(typeof Job, 'function');
assert.equal(typeof SceneManager, 'function');
assert.equal(new Parser().parseCommand('G1 X42').params.x, 42);
assert.throws(() => require.resolve('lil-gui'), { code: 'MODULE_NOT_FOUND' });
for (const path of ['dist/gcode-preview.es.js', 'dist/gcode-preview.d.ts', 'src/gcode-preview', 'parser']) {
  await assert.rejects(import('gcode-preview/' + path), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}
`
  );
  run(process.execPath, ['smoke.mjs']);

  // Install the declaration dependencies explicitly, as a TypeScript consumer would.
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `typescript@${lock.packages['node_modules/typescript'].version}`,
    `@types/three@${pkg.devDependencies['@types/three']}`,
    `@webgpu/types@${pkg.devDependencies['@webgpu/types']}`
  ]);
  writeFileSync(
    join(consumer, 'consumer.ts'),
    `import { GCodePreview, Parser, type GCodePreviewOptions } from 'gcode-preview';
const options: GCodePreviewOptions = { canvas: document.createElement('canvas') };
new GCodePreview(options).processGCode('G1 X42');
const x: number | undefined = new Parser().parseCommand('G1 X42')?.params.x;
void x;
`
  );
  for (const [moduleResolution, module] of [
    ['node', 'esnext'],
    ['node16', 'node16'],
    ['nodenext', 'nodenext'],
    ['bundler', 'esnext']
  ]) {
    console.log(`Packaging: typecheck with moduleResolution=${moduleResolution}`);
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          moduleResolution,
          module,
          target: 'es2020',
          strict: true,
          noEmit: true,
          types: ['@webgpu/types']
        },
        files: ['consumer.ts']
      })
    );
    run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  }
  console.log('Packaging smoke test passed (runtime, exports, and four TypeScript resolution modes).');
  rmSync(consumer, { recursive: true, force: true });
} catch (error) {
  console.error(`Packaging fixture and command log retained at ${consumer}`);
  throw error;
}

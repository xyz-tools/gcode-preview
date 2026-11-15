/* eslint-env node */
import pkg from './package.json' with { type: 'json' };
import { dts } from 'rolldown-plugin-dts';
import { rmSync } from 'node:fs';

const isProd = process.env.NODE_ENV !== 'development';
// Add future public entry points here so Rolldown can share their implementation.
const input = { 'gcode-preview': 'src/gcode-preview.ts' };
const external = Object.keys(pkg.dependencies);
const config = [
  {
    input,
    // Matches tsconfig's `target`; Rolldown does not read tsconfig for this.
    transform: { target: 'es2015' },
    output: {
      dir: 'dist',
      format: 'es',
      entryFileNames: '[name].es.js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      minify: isProd
    },
    external,
    plugins: [
      {
        name: 'clean-dist',
        buildStart() {
          rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });
        }
      }
    ]
  }
];

if (isProd) {
  console.log('Building type definitions');
  config.push({
    input,
    output: { dir: 'dist', chunkFileNames: 'chunks/[name]-[hash].d.ts', format: 'es' },
    external,
    plugins: [dts({ emitDtsOnly: true })]
  });
}

export default config;

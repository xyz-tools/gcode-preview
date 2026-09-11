/* eslint-env node */
import pkg from './package.json' with { type: 'json' };
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rmSync } from 'node:fs';

const isProd = process.env.NODE_ENV !== 'development';
// Add future public entry points here so Rollup can share their implementation.
const input = { 'gcode-preview': 'src/gcode-preview.ts' };
const external = Object.keys(pkg.dependencies);
const config = [
  {
    input,
    output: {
      dir: 'dist',
      format: 'es',
      entryFileNames: '[name].es.js',
      chunkFileNames: 'chunks/[name]-[hash].js'
    },
    external,
    plugins: [
      {
        name: 'clean-dist',
        buildStart() {
          rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });
        }
      },
      nodeResolve(),
      esbuild({
        minify: isProd
      })
    ]
  }
];

if (isProd) {
  console.log('Building type definitions');
  config.push({
    input,
    output: { dir: 'dist', entryFileNames: '[name].d.ts', chunkFileNames: 'chunks/[name]-[hash].d.ts', format: 'es' },
    external,
    plugins: [dts()]
  });
}

export default config;

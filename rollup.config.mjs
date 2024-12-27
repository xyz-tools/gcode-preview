/* eslint-env node */
import pkg from './package.json' with { type: 'json' };
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const isProd = process.env.NODE_ENV !== 'development';
const config = [
  {
    input: 'src/gcode-preview.ts', // our source file
    output: [
      {
        file: pkg.main,
        format: 'es' // the preferred format
      },
      {
        file: 'dist/gcode-preview.js',
        format: 'umd', // deprecated. might not work at some point
        name: 'GCodePreview', // the global which can be used in a browser
        globals: {
          three: 'THREE'
        }
      }
    ],
    external: [...Object.keys(pkg.dependencies || {})],
    plugins: [
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
    input: 'src/gcode-preview.ts',
    output: { file: 'dist/gcode-preview.d.ts', format: 'es' },
    plugins: [dts()]
  });
}

export default config;

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, defaultExclude } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

const fullCoverage = { statements: 100, branches: 100, functions: 100, lines: 100 };

const sourceFiles = readdirSync(join(root, 'src'), { recursive: true })
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => file.endsWith('.ts') && !file.startsWith('__tests__/'))
  .map((file) => `src/${file}`);

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.ts'],
    // *.test-d.ts files are compile-time-only pins, run by the typecheck
    // pass below rather than as runtime tests.
    exclude: [...defaultExclude, 'src/__tests__/**/*.test-d.ts'],
    environment: 'happy-dom',
    globals: true,
    typecheck: {
      enabled: true,
      include: ['src/__tests__/**/*.test-d.ts'],
      // Strict mode so expect-type assertions actually bite (they silently
      // pass without strictNullChecks). Source files stay on the main
      // tsconfig via `npm run typeCheck`, so their strict errors are noise
      // here and are ignored.
      tsconfig: './tsconfig.typecheck.json',
      ignoreSourceErrors: true
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
      // 100% coverage is the default for every file under src/. Files listed
      // below are grandfathered at their current coverage and fail CI if they
      // regress. Raise (and eventually remove) an entry as coverage improves.
      thresholds: {
        perFile: true,
        ...Object.fromEntries(sourceFiles.map((file) => [file, fullCoverage])),
        'src/dev-gui.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
        'src/gcode-preview.ts': { statements: 93.9, branches: 79.48, functions: 100, lines: 94.87 },
        'src/indexers.ts': { statements: 96.66, branches: 96.15, functions: 100, lines: 96.66 },
        'src/path.ts': { statements: 95.12, branches: 89.47, functions: 83.33, lines: 97.29 },
        'src/thumbnail.ts': { statements: 92.3, branches: 100, functions: 75, lines: 92.3 },
        'src/extra/dom-utils.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
        'src/helpers/grid.ts': { statements: 93.33, branches: 66.66, functions: 66.66, lines: 96.29 },
        'src/helpers/split-chunk.ts': { statements: 75, branches: 50, functions: 100, lines: 75 }
      }
    }
  }
});

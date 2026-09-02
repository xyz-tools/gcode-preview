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
      // 100% coverage is required for every file under src/. To grandfather a
      // file at lower coverage, add an entry after the spread pinning its
      // current numbers, and raise (then remove) it as coverage improves.
      thresholds: {
        perFile: true,
        ...Object.fromEntries(sourceFiles.map((file) => [file, fullCoverage]))
      }
    }
  }
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
      // Files that have reached full coverage. These thresholds fail CI if
      // coverage ever regresses. Add more files here as they hit 100%.
      thresholds: {
        'src/gcode-parser.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/extrusion-geometry.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/scene-manager.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/objects-manager.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/bounding-box.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/job.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/interpreter.ts': { statements: 100, branches: 100, functions: 100, lines: 100 }
      }
    }
  }
});

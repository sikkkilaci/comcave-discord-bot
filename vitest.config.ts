import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Repository-/Service-Tests teilen sich eine SQLite-Datei; parallele
    // Testdateien wuerden zu "database is locked"-Fehlern fuehren.
    fileParallelism: false,
  },
});

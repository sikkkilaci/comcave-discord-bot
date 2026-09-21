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
    // Der Kursinhalte-Idempotenz-Test fuehrt real ueber 1000 sequentielle
    // Prisma-Aufrufe aus (592 Eintraege, zweimal importiert) - auf einem
    // langsameren/geteilten CI-Runner reicht das vitest-Standard-Timeout von
    // 5000ms knapp nicht aus (lokal ~2700ms, auf GitHub Actions beobachtet:
    // Timeout bei genau 5000ms). Grosszuegigerer, weiterhin klar begrenzter
    // Puffer statt eines Einzel-Test-Overrides, da mehrere Tests in dieser
    // Datei echte DB-Operationen in aehnlicher Groessenordnung durchfuehren.
    testTimeout: 15000,
  },
});

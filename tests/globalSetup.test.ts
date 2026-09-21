import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseFilePath, resolveTestDatabaseUrl } from './globalSetup.js';

/**
 * Regressionstest fuer den DATABASE_URL-/Testdatenbank-Mismatch: globalSetup.ts
 * hat frueher unabhaengig von der Umgebung immer "file:./test.db" migriert,
 * waehrend tests/setup.ts ein bereits gesetztes DATABASE_URL (z. B. durch die
 * CI-Workflow-Konfiguration) respektiert hat. Migration und Testprozess liefen
 * dadurch gegen unterschiedliche SQLite-Dateien ("table does not exist").
 * Diese Tests stellen sicher, dass resolveTestDatabaseUrl() - die einzige
 * Stelle, die globalSetup.ts fuer die Migration verwendet - exakt derselben
 * Fallback-Regel folgt wie tests/setup.ts.
 */
describe('globalSetup: Testdatenbank-Aufloesung', () => {
  it('faellt ohne gesetztes DATABASE_URL auf denselben Default wie tests/setup.ts zurueck', () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(resolveTestDatabaseUrl()).toBe('file:./test.db');
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it(
    'uebernimmt ein bereits gesetztes DATABASE_URL (z. B. aus der CI-Workflow-Konfiguration) ' +
      'statt es zu ignorieren',
    () => {
      const original = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'file:./ci.db';
      try {
        expect(resolveTestDatabaseUrl()).toBe('file:./ci.db');
      } finally {
        if (original === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = original;
      }
    },
  );

  it('leitet aus einem file:-DATABASE_URL denselben absoluten Pfad ab, den Prisma selbst verwendet', () => {
    const filePath = resolveTestDatabaseFilePath('file:./ci.db');
    expect(filePath).toBe(path.resolve(process.cwd(), 'prisma', 'ci.db'));
  });
});

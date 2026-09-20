import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

// Muss zum DATABASE_URL in tests/setup.ts passen ("file:./test.db", relativ zu
// prisma/schema.prisma aufgeloest = prisma/test.db).
const dbFile = path.resolve(process.cwd(), 'prisma', 'test.db');
const journalFile = `${dbFile}-journal`;

function removeTestDb(): void {
  for (const file of [dbFile, journalFile]) {
    if (existsSync(file)) rmSync(file);
  }
}

/**
 * Vitest globalSetup: legt einmalig vor dem gesamten Testlauf eine frische
 * SQLite-Testdatenbank an, indem die bestehenden Prisma-Migrationen darauf
 * angewendet werden. So testen Repository/Service-Tests gegen ein echtes,
 * per Migration erzeugtes Schema statt gegen Mocks.
 */
export default function setup(): () => void {
  removeTestDb();

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });

  return removeTestDb;
}

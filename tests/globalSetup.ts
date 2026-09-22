import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Liefert das DATABASE_URL, gegen das dieser Testlauf migriert wird. Faellt -
 * wie tests/setup.ts (`process.env.DATABASE_URL ??= 'file:./test.db'`) - nur
 * dann auf den Default zurueck, wenn noch keins gesetzt ist, statt (wie
 * frueher) unabhaengig davon immer denselben Wert zu erzwingen. Migration
 * (hier) und Testprozess (tests/setup.ts) lesen dieselbe Umgebungsvariable
 * mit derselben Fallback-Regel und muessen daher immer dieselbe SQLite-Datei
 * verwenden - vorher konnte z. B. ein von aussen bereits gesetztes
 * DATABASE_URL (etwa durch die CI-Workflow-Konfiguration) dazu fuehren, dass
 * hier eine andere Datei migriert wurde als die, gegen die der Testprozess
 * tatsaechlich lief ("table does not exist").
 */
export function resolveTestDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'file:./test.db';
}

/** Leitet aus einem `file:`-DATABASE_URL den absoluten Pfad ab (relativ zu prisma/schema.prisma, wie Prisma ihn selbst aufloest). */
export function resolveTestDatabaseFilePath(databaseUrl: string): string {
  const relativePath = databaseUrl.replace(/^file:/, '').replace(/^\.\//, '');
  return path.resolve(process.cwd(), 'prisma', relativePath);
}

const databaseUrl = resolveTestDatabaseUrl();
const dbFile = resolveTestDatabaseFilePath(databaseUrl);
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
/**
 * `execFileSync()` sucht die uebergebene Datei ohne Shell-Interpretation -
 * unter Windows heisst das npm-CLI-Binary aber `npx.cmd`, nicht `npx`
 * (das nackte `npx` existiert dort nur als Shell-Funktion/Alias). Ohne diese
 * Fallunterscheidung schlaegt der Aufruf unter Windows mit "spawnSync npx
 * ENOENT" fehl, obwohl npx tatsaechlich installiert und im PATH ist.
 */
const NPX_COMMAND = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export default function setup(): () => void {
  removeTestDb();

  execFileSync(NPX_COMMAND, ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  return removeTestDb;
}

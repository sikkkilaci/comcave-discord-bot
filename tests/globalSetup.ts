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
 * Windows fuehrt `.cmd`/`.bat`-Dateien (wie `npx.cmd`, dem tatsaechlichen
 * npx-Binary auf Windows) nicht als eigenstaendiges Programm aus, sondern nur
 * als Kommando *innerhalb* von `cmd.exe` - `CreateProcess` kann ein Batch-
 * Skript nicht direkt starten. `execFileSync('npx.cmd', ...)` ohne
 * Shell-Interpretation schlaegt deshalb mit EINVAL fehl, selbst wenn der
 * Dateiname korrekt aufgeloest wurde (der zuvor versuchte Fix, nur den
 * Dateinamen auf `npx.cmd` umzustellen, hat daher nicht ausgereicht). Die von
 * Node.js selbst empfohlene Loesung ist `shell: true` beim Aufruf einer
 * `.cmd`/`.bat`-Datei (siehe Node-Doku "Spawning .bat and .cmd files on
 * Windows") - dann uebernimmt cmd.exe sowohl die PATHEXT-Aufloesung von
 * `npx` als auch die korrekte Ausfuehrung. Unter Linux/macOS/CI bleibt das
 * Verhalten unveraendert (shell: false, exakt wie zuvor), da dort kein
 * Batch-Interpreter noetig ist und die Argumente ohnehin literal sind (kein
 * Injection-Risiko durch `shell: true`).
 */
const IS_WINDOWS = process.platform === 'win32';

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
    shell: IS_WINDOWS,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  return removeTestDb;
}

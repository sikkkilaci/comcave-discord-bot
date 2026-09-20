import { Prisma, PrismaClient } from '@prisma/client';
import { isDevelopment } from '../config/env.js';

declare global {
  // Singleton-Pattern fuer Hot-Reload im Dev-Modus (var ist hier durch `declare global` erforderlich).
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: isDevelopment ? ['warn', 'error'] : ['error'],
  });

if (isDevelopment) {
  global.__prisma = prisma;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Prueft, ob ein Fehler eine verletzte Unique-Constraint ist (Prisma-Code
 * "P2002"). Wird von Repository-Funktionen verwendet, die vor einem `create()`
 * erst per `findUnique()` pruefen, ob ein Datensatz bereits existiert (z. B.
 * Kenntnisnahme, Lerngruppen-Beitritt): dieser "find then create"-Ablauf ist
 * fuer sich genommen nicht atomar, daher kann bei zwei nahezu gleichzeitigen
 * Aufrufen (z. B. Doppelklick) trotzdem `create()` fuer beide Aufrufe
 * versucht werden. Die Unique-Constraint der Datenbank verhindert dabei
 * zuverlaessig ein Duplikat - der Aufrufer soll den zweiten (verlierenden)
 * Versuch aber als "bereits vorhanden" statt als unerwarteten Fehler
 * behandeln koennen.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

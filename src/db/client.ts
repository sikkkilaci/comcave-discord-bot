import { PrismaClient } from '@prisma/client';
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

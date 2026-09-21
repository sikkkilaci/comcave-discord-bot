import type { ComcaveLocation } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface UpsertLocationInput {
  code: string;
  name: string;
  state: string;
  city: string;
  postalCode?: string | null;
}

/**
 * Legt einen COMCAVE-Standort an oder aktualisiert ihn, falls derselbe `code`
 * bereits existiert - Grundlage fuer einen idempotenten Import (siehe
 * locationImportService.ts): ein wiederholter Import mit unveraenderter
 * Quelle erzeugt daher nie Duplikate. Ein erneut importierter Standort wird
 * automatisch wieder aktiviert (`isActive: true`), falls er zuvor deaktiviert
 * war.
 */
export async function upsertLocation(
  input: UpsertLocationInput,
): Promise<{ location: ComcaveLocation; created: boolean }> {
  const postalCode = input.postalCode ?? null;
  const existing = await prisma.comcaveLocation.findUnique({ where: { code: input.code } });

  const location = await prisma.comcaveLocation.upsert({
    where: { code: input.code },
    update: {
      name: input.name,
      state: input.state,
      city: input.city,
      postalCode,
      isActive: true,
    },
    create: {
      code: input.code,
      name: input.name,
      state: input.state,
      city: input.city,
      postalCode,
      isActive: true,
    },
  });

  return { location, created: existing === null };
}

/** Deaktiviert alle Standorte, deren `code` NICHT in der aktuellen Importliste enthalten ist. */
export async function deactivateLocationsNotIn(codes: string[]): Promise<number> {
  const result = await prisma.comcaveLocation.updateMany({
    where: { code: { notIn: codes }, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}

export async function getLocationById(id: string): Promise<ComcaveLocation | null> {
  return prisma.comcaveLocation.findUnique({ where: { id } });
}

/**
 * Sucht aktive Standorte per Teilstring auf Name/Stadt/PLZ (case-insensitive)
 * - Grundlage fuer die Discord-Autocomplete-Suche unter `/standort-waehlen`
 * (siehe locationCommand). Discord erlaubt maximal 25 Autocomplete-Vorschlaege,
 * daher `take` als Limit statt einer vollstaendigen Ergebnisliste.
 */
export async function searchActiveLocations(query: string, take = 25): Promise<ComcaveLocation[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return prisma.comcaveLocation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take,
    });
  }

  return prisma.comcaveLocation.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: trimmed } },
        { city: { contains: trimmed } },
        { state: { contains: trimmed } },
        { postalCode: { contains: trimmed } },
      ],
    },
    orderBy: { name: 'asc' },
    take,
  });
}

export async function countActiveLocations(): Promise<number> {
  return prisma.comcaveLocation.count({ where: { isActive: true } });
}

/**
 * Baut eine einheitliche Anzeigebezeichnung fuer einen Standort (u. a. fuer
 * Discord-Autocomplete-Vorschlaege) - `postalCode` ist optional (nicht jeder
 * offizielle Standort hat eine verifizierte PLZ) und wird daher nur
 * angehaengt, wenn vorhanden.
 */
export function formatLocationLabel(location: ComcaveLocation): string {
  const plz = location.postalCode ? ` ${location.postalCode}` : '';
  return `${location.name} - ${location.city}${plz} (${location.state})`;
}

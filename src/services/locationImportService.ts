import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  deactivateLocationsNotIn,
  upsertLocation,
  type UpsertLocationInput,
} from '../repositories/locationRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { ValidationError, PermissionError } from '../utils/errors.js';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Standard-Pfad der Standort-Quelldatei (repo-relativ). Enthaelt einen
 * verifizierten Teilbestand echter COMCAVE-Standorte (Quelle, Stand und
 * Grenzen der Erhebung siehe data/locations/README.md); die Liste kann von
 * der Administration jederzeit um weitere offiziell verifizierte Standorte
 * ergaenzt werden, ohne dass sich Format oder Importlogik aendern.
 */
export const DEFAULT_LOCATION_SOURCE_FILE = 'data/locations/comcave-standorte.json';

function resolveSourceFilePath(relativePath: string): string {
  return path.join(PROJECT_ROOT, relativePath);
}

const locationEntrySchema = z.object({
  code: z.string().trim().min(1, 'code darf nicht leer sein.'),
  name: z.string().trim().min(1, 'name darf nicht leer sein.'),
  state: z.string().trim().min(1, 'state darf nicht leer sein.'),
  city: z.string().trim().min(1, 'city darf nicht leer sein.'),
  postalCode: z.string().trim().min(1, 'postalCode darf nicht leer sein.').optional(),
});

const locationSourceSchema = z.array(locationEntrySchema);

export type ParsedLocation = z.infer<typeof locationEntrySchema>;

/**
 * Parst die Standort-Quelldatei (JSON-Array, siehe data/locations/README.md).
 * Reine Funktion ohne Datei-/DB-Zugriff, daher direkt testbar. Wirft
 * ValidationError bei ungueltigem JSON oder einem Eintrag, der nicht dem
 * erwarteten Format entspricht - Import wird dann vollstaendig abgebrochen,
 * statt unvollstaendige/fehlerhafte Daten zu uebernehmen.
 */
export function parseLocationSource(fileContent: string): ParsedLocation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fileContent);
  } catch {
    throw new ValidationError('Standort-Quelldatei ist kein gueltiges JSON - Import abgebrochen.');
  }

  const result = locationSourceSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'Standort-Quelldatei entspricht nicht dem erwarteten Format ' +
        '(Array aus {code, name, state, city, postalCode?}) - Import abgebrochen.',
    );
  }

  const codes = result.data.map((entry) => entry.code);
  if (new Set(codes).size !== codes.length) {
    throw new ValidationError(
      'Standort-Quelldatei enthaelt doppelte "code"-Werte - Import abgebrochen.',
    );
  }

  return result.data;
}

export interface LocationImportSummary {
  sourceFile: string;
  created: number;
  updated: number;
  deactivated: number;
}

/**
 * Liest die Standort-Quelldatei ein, parst sie und synchronisiert den
 * gesamten Katalog (idempotenter Upsert je `code`, siehe
 * upsertLocation()). Standorte, die in der Quelldatei NICHT mehr enthalten
 * sind, werden deaktiviert statt geloescht (siehe deactivateLocationsNotIn())
 * - bestehende Member.locationId-Zuordnungen bleiben dadurch immer gueltig
 * (onDelete: SetNull greift nur bei tatsaechlichem Loeschen). Reiner
 * Datenimport ohne Berechtigungspruefung - Vertrauensgrenze wie bei einem
 * Repository, gedacht fuer den Aufruf sowohl aus dem CLI-Skript
 * (src/scripts/importLocations.ts) als auch aus importLocationsAsAdmin()
 * unten (Discord-Admin-Command, MIT Berechtigungspruefung).
 */
export async function importLocationsFromFile(
  sourceFile: string = DEFAULT_LOCATION_SOURCE_FILE,
): Promise<LocationImportSummary> {
  let fileContent: string;
  try {
    fileContent = await readFile(resolveSourceFilePath(sourceFile), 'utf-8');
  } catch {
    throw new ValidationError(
      `Standort-Quelldatei "${sourceFile}" wurde nicht gefunden. Bitte zuerst die offizielle ` +
        'COMCAVE-Standortliste dort ablegen (siehe data/locations/README.md fuer das Format).',
    );
  }
  const entries = parseLocationSource(fileContent);

  let created = 0;
  let updated = 0;
  for (const entry of entries) {
    const input: UpsertLocationInput = { ...entry, postalCode: entry.postalCode ?? null };
    const { created: wasCreated } = await upsertLocation(input);
    if (wasCreated) created += 1;
    else updated += 1;
  }

  const deactivated = await deactivateLocationsNotIn(entries.map((entry) => entry.code));

  return { sourceFile, created, updated, deactivated };
}

/**
 * Discord-Admin-Einstiegspunkt fuer den Standort-Import
 * (`/setup-standorte-importieren`). ADMIN-only (isServerAdmin()) - der
 * Standort-Katalog ist eine organisationsweite Verwaltungsangelegenheit,
 * keine Klassenleitungs-Aufgabe.
 */
export async function importLocationsAsAdmin(
  guildConfig: GuildConfig,
  member: GuildMember,
  actorDiscordId: string,
  sourceFile: string = DEFAULT_LOCATION_SOURCE_FILE,
): Promise<LocationImportSummary> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen Standortdaten importieren.');
  }

  const summary = await importLocationsFromFile(sourceFile);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'location.import',
    metadata: { ...summary },
  });

  return summary;
}

/**
 * Reproduzierbares Import-Skript fuer den COMCAVE-Standort-Katalog aus einer
 * versionierten Quelldatei (siehe data/locations/README.md). Laeuft
 * ausserhalb des Discord-Bots (kein GuildMember/keine Discord-Verbindung
 * noetig) - dieselbe Vertrauensstufe wie deployCommands.ts. Der Standort-
 * Katalog ist global (nicht guild-gescoped), daher braucht dieses Skript -
 * anders als importCoursePlan.ts - keine guildId.
 *
 * Aufruf: tsx src/scripts/importLocations.ts [pfad-zur-quelldatei]
 */
import {
  DEFAULT_LOCATION_SOURCE_FILE,
  importLocationsFromFile,
} from '../services/locationImportService.js';
import { disconnectDatabase } from '../db/client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('importLocations');

async function run(): Promise<void> {
  const sourceFile = process.argv[2] ?? DEFAULT_LOCATION_SOURCE_FILE;

  const summary = await importLocationsFromFile(sourceFile);

  logger.info(summary, 'Standort-Import abgeschlossen.');
}

run()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Standort-Import fehlgeschlagen.');
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectDatabase();
  });

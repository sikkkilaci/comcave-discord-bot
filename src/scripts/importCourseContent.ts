/**
 * Reproduzierbares Import-Skript fuer den Kursinhalte-Katalog aus einer
 * versionierten Quelldatei (siehe data/course-plans/README.md). Laeuft
 * ausserhalb des Discord-Bots (kein GuildMember/keine Discord-Verbindung
 * noetig) - dieselbe Vertrauensstufe wie deployCommands.ts. Der
 * Kursinhalte-Katalog ist global (nicht guild-gescoped), daher braucht
 * dieses Skript - anders als importCoursePlan.ts - keine guildId.
 *
 * Aufruf: tsx src/scripts/importCourseContent.ts [pfad-zur-quelldatei]
 */
import {
  DEFAULT_COURSE_CONTENT_SOURCE_FILE,
  importCourseContentFromFile,
} from '../services/courseContentImportService.js';
import { disconnectDatabase } from '../db/client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('importCourseContent');

async function run(): Promise<void> {
  const sourceFile = process.argv[2] ?? DEFAULT_COURSE_CONTENT_SOURCE_FILE;

  const summary = await importCourseContentFromFile(sourceFile);

  logger.info(summary, 'Kursinhalte-Import abgeschlossen.');
}

run()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Kursinhalte-Import fehlgeschlagen.');
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectDatabase();
  });

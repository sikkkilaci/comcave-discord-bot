/**
 * Reproduzierbares Seed-/Import-Skript fuer Kursplan-Daten aus einer
 * versionierten Quelldatei (siehe COURSE_PLAN_SOURCE_FILES in
 * coursePlanImportService.ts). Laeuft ausserhalb des Discord-Bots (kein
 * GuildMember/keine Discord-Verbindung noetig) - dieselbe Vertrauensstufe wie
 * deployCommands.ts: ein Operator mit Zugriff auf DATABASE_URL/das Repository
 * gilt hier als bereits autorisiert, eine zusaetzliche Berechtigungspruefung
 * waere nur Schein-Sicherheit.
 *
 * Aufruf: tsx src/scripts/importCoursePlan.ts <guildId> <actorDiscordId> [klasse=A]
 */
import { getOrCreateGuildConfig } from '../repositories/guildConfigRepository.js';
import { getOrCreateClass } from '../repositories/classRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  COURSE_PLAN_SOURCE_FILES,
  importCoursePlanFromFile,
} from '../services/coursePlanImportService.js';
import { classNameSchema } from '../types/domain.js';
import { disconnectDatabase } from '../db/client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('importCoursePlan');

async function run(): Promise<void> {
  const [guildId, actorDiscordId, klasseArg] = process.argv.slice(2);

  if (!guildId || !actorDiscordId) {
    throw new Error(
      'Aufruf: tsx src/scripts/importCoursePlan.ts <guildId> <actorDiscordId> [klasse=A]',
    );
  }

  const className = classNameSchema.parse(klasseArg ?? 'A');
  const sourceFile = COURSE_PLAN_SOURCE_FILES[className];
  if (!sourceFile) {
    throw new Error(`Fuer Klasse ${className} ist noch keine Kursplan-Quelldatei hinterlegt.`);
  }

  await getOrCreateGuildConfig(guildId);
  const klasse = await getOrCreateClass(guildId, className);

  const summary = await importCoursePlanFromFile(guildId, klasse.id, sourceFile, actorDiscordId);

  await logAuditEvent({
    guildId,
    actorDiscordId,
    action: 'coursePlan.import',
    metadata: { className, ...summary },
  });

  logger.info({ className, ...summary }, 'Kursplan-Import abgeschlossen.');
}

run()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Kursplan-Import fehlgeschlagen.');
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectDatabase();
  });

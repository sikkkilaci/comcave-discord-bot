import type { Class, CourseEntry } from '@prisma/client';
import { listClasses } from '../repositories/classRepository.js';
import {
  listCourseEntriesNeedingUpcomingNotification,
  recordUpcomingNotification,
} from '../repositories/coursePlanRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { toDateOnlyUtc } from '../utils/dateTime.js';

/** Fenster fuer den "Kurs beginnt bald"-Hinweis, siehe Anforderung "7-Tage-Hinweis". */
export const UPCOMING_NOTICE_WINDOW_DAYS = 7;

/**
 * Audit-Log-Eintraege dieses Moduls werden nicht von einem Discord-Nutzer
 * ausgeloest, sondern von einer wiederkehrenden Systempruefung (siehe
 * checkUpcomingCourseNotificationsForGuild(), aufgerufen aus dem
 * `ready`-Event). `actorDiscordId` ist in AuditLogEntry ein Pflichtfeld -
 * dieser Sentinel-Wert macht im Log sichtbar, dass kein Mitglied, sondern der
 * Bot selbst die Aktion ausgeloest hat.
 */
const SYSTEM_ACTOR = 'system';

/**
 * Prueft eine einzelne Klasse auf Kurse, die innerhalb von
 * `UPCOMING_NOTICE_WINDOW_DAYS` beginnen UND fuer die noch kein Hinweis
 * erzeugt wurde (siehe listCourseEntriesNeedingUpcomingNotification() -
 * CourseUpcomingNotification ist `@unique` pro Kurs, daher verhindert
 * bereits das Schema doppelte Eintraege). Jeder neu erkannte Kurs wird sofort
 * als benachrichtigt vermerkt UND im Audit-Log protokolliert, bevor die
 * Funktion zurueckkehrt - wiederholte Aufrufe (z. B. bei jedem Bot-Start)
 * liefern denselben Kurs daher nie ein zweites Mal.
 */
export async function findAndRecordUpcomingCourseNotifications(
  guildId: string,
  classId: string,
  className: string,
  now: Date = new Date(),
): Promise<CourseEntry[]> {
  const today = toDateOnlyUtc(now);
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + UPCOMING_NOTICE_WINDOW_DAYS);

  const dueEntries = await listCourseEntriesNeedingUpcomingNotification(classId, today, windowEnd);

  const notified: CourseEntry[] = [];
  for (const entry of dueEntries) {
    await recordUpcomingNotification({ guildId, classId, courseEntryId: entry.id });
    await logAuditEvent({
      guildId,
      actorDiscordId: SYSTEM_ACTOR,
      action: 'coursePlan.upcomingNotice',
      metadata: {
        courseEntryId: entry.id,
        courseNumber: entry.courseNumber,
        title: entry.title,
        startDate: entry.startDate.toISOString(),
        className,
      },
    });
    notified.push(entry);
  }

  return notified;
}

export interface ClassUpcomingNotifications {
  klasse: Class;
  entries: CourseEntry[];
}

/**
 * Prueft alle Klassen einer Guild auf faellige 7-Tage-Hinweise. Wird aus dem
 * `ready`-Event aufgerufen (siehe src/bot/events/ready.ts), damit jeder
 * Bot-Start automatisch neue anstehende Kurse erkennt, ohne eine separate
 * Scheduler-Infrastruktur einzufuehren. Liefert nur Klassen mit tatsaechlich
 * neu erkannten Kursen zurueck, inkl. der vollstaendigen Class-Zeile, damit
 * der Aufrufer z. B. `announcementChannelId` fuer eine Discord-Benachrichtigung
 * verwenden kann, ohne erneut nachzuladen.
 */
export async function checkUpcomingCourseNotificationsForGuild(
  guildId: string,
  now: Date = new Date(),
): Promise<ClassUpcomingNotifications[]> {
  const classes = await listClasses(guildId);
  const results: ClassUpcomingNotifications[] = [];

  for (const klasse of classes) {
    const entries = await findAndRecordUpcomingCourseNotifications(
      guildId,
      klasse.id,
      klasse.name,
      now,
    );
    if (entries.length > 0) {
      results.push({ klasse, entries });
    }
  }

  return results;
}

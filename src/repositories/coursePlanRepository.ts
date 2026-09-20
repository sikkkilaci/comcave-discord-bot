import type {
  CourseAcknowledgment,
  CourseEntry,
  CourseSpecialDay,
  CourseUpcomingNotification,
} from '@prisma/client';
import { prisma } from '../db/client.js';

export interface UpsertCourseEntryInput {
  guildId: string;
  classId: string;
  courseNumber: string;
  title: string;
  trainer: string | null;
  startDate: Date;
  endDate: Date;
  sourceFile: string;
  createdByDiscordId: string;
}

/**
 * Legt einen Kurs-Slot an oder aktualisiert ihn, falls derselbe Slot (Klasse +
 * Kursnummer + Startdatum) bereits existiert - die Grundlage fuer einen
 * idempotenten Import (siehe coursePlanImportService.ts): ein wiederholter
 * Import mit unveraenderter Quelle erzeugt daher nie Duplikate, ein Import
 * nach einer Quelldatei-Aenderung uebernimmt die geaenderten Felder gezielt.
 */
export async function upsertCourseEntry(
  input: UpsertCourseEntryInput,
): Promise<{ entry: CourseEntry; created: boolean }> {
  const existing = await prisma.courseEntry.findUnique({
    where: {
      classId_courseNumber_startDate: {
        classId: input.classId,
        courseNumber: input.courseNumber,
        startDate: input.startDate,
      },
    },
  });

  const entry = await prisma.courseEntry.upsert({
    where: {
      classId_courseNumber_startDate: {
        classId: input.classId,
        courseNumber: input.courseNumber,
        startDate: input.startDate,
      },
    },
    update: {
      title: input.title,
      trainer: input.trainer,
      endDate: input.endDate,
      sourceFile: input.sourceFile,
    },
    create: input,
  });

  return { entry, created: existing === null };
}

/** Immer nach `guildId` gescoped, damit eine Kurs-ID nie serveruebergreifend Daten preisgibt. */
export async function getCourseEntryById(
  guildId: string,
  courseEntryId: string,
): Promise<CourseEntry | null> {
  return prisma.courseEntry.findFirst({ where: { id: courseEntryId, guildId } });
}

export async function listCourseEntriesByClassId(classId: string): Promise<CourseEntry[]> {
  return prisma.courseEntry.findMany({ where: { classId }, orderBy: { startDate: 'asc' } });
}

export interface UpsertCourseSpecialDayInput {
  guildId: string;
  classId: string;
  label: string;
  startDate: Date;
  endDate: Date;
  sourceFile: string;
}

/** Wie upsertCourseEntry(), aber fuer unterrichtsfreie/besondere Termine. */
export async function upsertCourseSpecialDay(
  input: UpsertCourseSpecialDayInput,
): Promise<{ specialDay: CourseSpecialDay; created: boolean }> {
  const where = {
    classId_startDate_endDate_label: {
      classId: input.classId,
      startDate: input.startDate,
      endDate: input.endDate,
      label: input.label,
    },
  } as const;

  const existing = await prisma.courseSpecialDay.findUnique({ where });
  const specialDay = await prisma.courseSpecialDay.upsert({
    where,
    update: { sourceFile: input.sourceFile },
    create: input,
  });

  return { specialDay, created: existing === null };
}

export async function listCourseSpecialDaysByClassId(classId: string): Promise<CourseSpecialDay[]> {
  return prisma.courseSpecialDay.findMany({ where: { classId }, orderBy: { startDate: 'asc' } });
}

/**
 * Bestaetigt Kenntnisnahme eines Kurs-Slots durch ein Mitglied. Eindeutig per
 * DB-Constraint (`@@unique([courseEntryId, memberDiscordId])`) - ein
 * erneuter Aufruf fuer denselben Kurs+Mitglied legt keinen zweiten Eintrag an,
 * sondern liefert die bereits bestehende Kenntnisnahme zurueck (`created:
 * false`), damit ein erneuter Klick auf den Button nie einen Duplikat-Fehler
 * ausloest.
 */
export async function acknowledgeCourseEntry(input: {
  guildId: string;
  classId: string;
  courseEntryId: string;
  memberDiscordId: string;
}): Promise<{ acknowledgment: CourseAcknowledgment; created: boolean }> {
  const existing = await prisma.courseAcknowledgment.findUnique({
    where: {
      courseEntryId_memberDiscordId: {
        courseEntryId: input.courseEntryId,
        memberDiscordId: input.memberDiscordId,
      },
    },
  });
  if (existing) {
    return { acknowledgment: existing, created: false };
  }

  const acknowledgment = await prisma.courseAcknowledgment.create({ data: input });
  return { acknowledgment, created: true };
}

export async function listAcknowledgmentsForCourseEntry(
  courseEntryId: string,
): Promise<CourseAcknowledgment[]> {
  return prisma.courseAcknowledgment.findMany({ where: { courseEntryId } });
}

export async function getAcknowledgment(
  courseEntryId: string,
  memberDiscordId: string,
): Promise<CourseAcknowledgment | null> {
  return prisma.courseAcknowledgment.findUnique({
    where: { courseEntryId_memberDiscordId: { courseEntryId, memberDiscordId } },
  });
}

/**
 * Findet alle Kurs-Slots einer Klasse, die innerhalb des angegebenen
 * Zeitraums beginnen UND fuer die noch KEINE CourseUpcomingNotification
 * existiert (`upcomingNotification: { is: null }`) - die zentrale
 * Dedup-Abfrage fuer den 7-Tage-Hinweis (siehe coursePlanNotificationService.ts).
 * Wiederholte Aufrufe (z. B. bei jedem Bot-Start) liefern nach dem ersten
 * Aufruf fuer denselben Kurs keinen weiteren Treffer mehr.
 */
export async function listCourseEntriesNeedingUpcomingNotification(
  classId: string,
  from: Date,
  to: Date,
): Promise<CourseEntry[]> {
  return prisma.courseEntry.findMany({
    where: {
      classId,
      startDate: { gte: from, lte: to },
      upcomingNotification: { is: null },
    },
    orderBy: { startDate: 'asc' },
  });
}

export async function recordUpcomingNotification(input: {
  guildId: string;
  classId: string;
  courseEntryId: string;
}): Promise<CourseUpcomingNotification> {
  return prisma.courseUpcomingNotification.create({ data: input });
}

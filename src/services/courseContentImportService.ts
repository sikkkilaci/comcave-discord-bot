import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  replaceCourseContentForCourse,
  type UpsertCourseContentItemInput,
} from '../repositories/courseContentRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { ValidationError, PermissionError } from '../utils/errors.js';
import { parseGermanDate } from '../utils/dateTime.js';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Standard-Pfad der Kursinhalte-Quelldatei (repo-relativ). Strukturierte
 * Extraktion des eCampus-Kursinhalte-PDFs (siehe
 * data/course-plans/README.md fuer Quelle, Erhebungsmethode und den Grund,
 * warum das Roh-PDF selbst nicht als Laufzeitquelle dient).
 */
export const DEFAULT_COURSE_CONTENT_SOURCE_FILE = 'data/course-plans/kursinhalte.json';

function resolveSourceFilePath(relativePath: string): string {
  return path.join(PROJECT_ROOT, relativePath);
}

const courseContentSourceSchema = z.object({
  courses: z.array(
    z.object({
      courseId: z.string().trim().min(1, 'courseId darf nicht leer sein.'),
      title: z.string().trim().min(1, 'title darf nicht leer sein.'),
      contentItems: z.array(z.string()),
    }),
  ),
});

export interface ParsedCourseContentItem {
  orderIndex: number;
  numberPath: string;
  level: number;
  text: string;
}

export interface ParsedCourseWithContent {
  courseNumber: string;
  courseTitle: string;
  items: ParsedCourseContentItem[];
}

const CONTENT_LINE_PATTERN = /^(\d+)\.\s*(.*)$/s;

/**
 * Rekonstruiert die hierarchische Nummerierung eines Kurses aus der flachen
 * `contentItems`-Liste der Quelle. Die Quelle nummeriert jede Ebene fuer sich
 * neu bei 1 beginnend (siehe extractionNotes in der Quelldatei) - die Tiefe
 * eines Eintrags ist daher NICHT aus dem Text selbst ablesbar, sondern muss
 * deterministisch aus der Zahlenfolge hergeleitet werden: Ein Eintrag setzt
 * die Nummerierung einer bereits vorhandenen (moeglichst tiefen) Ebene fort,
 * wenn seine Zahl genau eins groesser ist als die letzte Zahl dieser Ebene -
 * andernfalls beginnt er (nur bei Zahl 1 gueltig) eine neue, tiefere Ebene
 * unterhalb des vorherigen Eintrags. Diese Regel wurde gegen alle 592
 * Eintraege der realen Quelldatei verifiziert (keine Abweichung) - ein
 * Eintrag, der weder Regel erfuellt, gilt als unerwartetes Format und bricht
 * den Import ab, statt eine geratene Tiefe zu uebernehmen.
 */
export function reconstructCourseContentHierarchy(rawItems: string[]): ParsedCourseContentItem[] {
  const levelCounters: number[] = [];
  const results: ParsedCourseContentItem[] = [];

  rawItems.forEach((raw, index) => {
    const match = CONTENT_LINE_PATTERN.exec(raw);
    if (!match) {
      throw new ValidationError(
        `Kursinhalt #${index + 1} entspricht nicht dem erwarteten Format "N. Text": "${raw}".`,
      );
    }
    const n = Number(match[1]);
    const text = (match[2] ?? '').trim();

    let matchedDepth = -1;
    for (let depth = levelCounters.length - 1; depth >= 0; depth -= 1) {
      const counterAtDepth = levelCounters[depth];
      if (counterAtDepth !== undefined && counterAtDepth + 1 === n) {
        matchedDepth = depth;
        break;
      }
    }

    if (matchedDepth >= 0) {
      levelCounters.length = matchedDepth + 1;
      levelCounters[matchedDepth] = n;
    } else if (n === 1) {
      levelCounters.push(1);
    } else {
      throw new ValidationError(
        `Kursinhalt #${index + 1} ("${raw}") laesst sich nicht in die Nummerierungshierarchie ` +
          'einordnen - unerwartetes Format, Import abgebrochen statt einer geratenen Struktur.',
      );
    }

    results.push({
      orderIndex: index,
      numberPath: levelCounters.join('.'),
      level: levelCounters.length,
      text,
    });
  });

  return results;
}

/**
 * Parst die Kursinhalte-Quelldatei (JSON, siehe data/course-plans/README.md).
 * Reine Funktion ohne Datei-/DB-Zugriff, daher direkt testbar. Wirft
 * ValidationError bei ungueltigem JSON, unerwartetem Format oder doppelten
 * `courseId`-Werten - Import wird dann vollstaendig abgebrochen, statt
 * unvollstaendige/fehlerhafte Daten zu uebernehmen. Kurse ohne Kursinhalte
 * (leeres `contentItems`-Array) liefern bewusst ein leeres `items`-Array,
 * statt Inhalte zu erfinden.
 */
export function parseCourseContentSource(fileContent: string): ParsedCourseWithContent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fileContent);
  } catch {
    throw new ValidationError(
      'Kursinhalte-Quelldatei ist kein gueltiges JSON - Import abgebrochen.',
    );
  }

  const result = courseContentSourceSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'Kursinhalte-Quelldatei entspricht nicht dem erwarteten Format ' +
        '(Objekt mit "courses": [{courseId, title, contentItems}]) - Import abgebrochen.',
    );
  }

  const courseIds = result.data.courses.map((course) => course.courseId);
  if (new Set(courseIds).size !== courseIds.length) {
    throw new ValidationError(
      'Kursinhalte-Quelldatei enthaelt doppelte "courseId"-Werte - Import abgebrochen.',
    );
  }

  return result.data.courses.map((course) => ({
    courseNumber: course.courseId,
    courseTitle: course.title,
    items: reconstructCourseContentHierarchy(course.contentItems),
  }));
}

const courseScheduleSourceSchema = z.object({
  courses: z.array(
    z.object({
      courseId: z.string().trim().min(1, 'courseId darf nicht leer sein.'),
      title: z.string().trim().min(1, 'title darf nicht leer sein.'),
      start: z.string().trim().min(1, 'start darf nicht leer sein.'),
      end: z.string().trim().min(1, 'end darf nicht leer sein.'),
    }),
  ),
});

export interface CourseScheduleEntry {
  courseNumber: string;
  courseTitle: string;
  start: Date;
  end: Date;
}

/**
 * Liest Kursnummer/-titel und Start-/Enddatum aller Kurse aus derselben
 * Quelldatei wie parseCourseContentSource() - bewusst eine EIGENE, kleinere
 * Schema-Definition statt courseContentSourceSchema zu erweitern, da
 * Start-/Enddatum laut data/course-plans/README.md bewusst NICHT importiert/
 * gespeichert werden (siehe dort, Abschnitt "Datenmodell") und dieser reine
 * Lese-Pfad daran nichts aendert: er liest die Termine bei jedem Aufruf frisch
 * aus der versionierten Quelldatei, statt eine zweite, potenziell abweichende
 * Datumsquelle in der DB anzulegen (Grundlage fuer courseCategoryService.ts).
 */
export function parseCourseSchedule(fileContent: string): CourseScheduleEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fileContent);
  } catch {
    throw new ValidationError(
      'Kursinhalte-Quelldatei ist kein gueltiges JSON - Import abgebrochen.',
    );
  }

  const result = courseScheduleSourceSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'Kursinhalte-Quelldatei entspricht nicht dem erwarteten Format ' +
        '(Objekt mit "courses": [{courseId, title, start, end}]) - Import abgebrochen.',
    );
  }

  return result.data.courses.map((course) => {
    try {
      return {
        courseNumber: course.courseId,
        courseTitle: course.title,
        start: parseGermanDate(course.start),
        end: parseGermanDate(course.end),
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(`Kurs "${course.courseId}" (${course.title}): ${error.message}`);
      }
      throw error;
    }
  });
}

/** Wie parseCourseSchedule(), aber liest die Quelldatei direkt von der Platte. */
export async function loadCourseSchedule(
  sourceFile: string = DEFAULT_COURSE_CONTENT_SOURCE_FILE,
): Promise<CourseScheduleEntry[]> {
  let fileContent: string;
  try {
    fileContent = await readFile(resolveSourceFilePath(sourceFile), 'utf-8');
  } catch {
    throw new ValidationError(`Kursinhalte-Quelldatei "${sourceFile}" wurde nicht gefunden.`);
  }
  return parseCourseSchedule(fileContent);
}

export interface CourseContentImportSummary {
  sourceFile: string;
  coursesProcessed: number;
  coursesWithContent: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsDeleted: number;
}

/**
 * Liest die Kursinhalte-Quelldatei ein, parst sie und synchronisiert die
 * Inhalte je Kurs (siehe replaceCourseContentForCourse()) - idempotent: ein
 * wiederholter Import mit unveraenderter Quelle erzeugt keine Duplikate und
 * veraendert keine Zaehler. Reiner Datenimport ohne Berechtigungspruefung -
 * Vertrauensgrenze wie bei einem Repository, gedacht fuer den Aufruf sowohl
 * aus dem CLI-Skript (src/scripts/importCourseContent.ts) als auch aus
 * importCourseContentAsAdmin() unten (Discord-Admin-Command, MIT
 * Berechtigungspruefung).
 */
export async function importCourseContentFromFile(
  sourceFile: string = DEFAULT_COURSE_CONTENT_SOURCE_FILE,
): Promise<CourseContentImportSummary> {
  let fileContent: string;
  try {
    fileContent = await readFile(resolveSourceFilePath(sourceFile), 'utf-8');
  } catch {
    throw new ValidationError(`Kursinhalte-Quelldatei "${sourceFile}" wurde nicht gefunden.`);
  }
  const courses = parseCourseContentSource(fileContent);

  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsDeleted = 0;
  let coursesWithContent = 0;

  for (const course of courses) {
    if (course.items.length > 0) coursesWithContent += 1;

    const items: UpsertCourseContentItemInput[] = course.items.map((item) => ({
      courseNumber: course.courseNumber,
      courseTitle: course.courseTitle,
      orderIndex: item.orderIndex,
      numberPath: item.numberPath,
      level: item.level,
      text: item.text,
      sourceFile,
    }));

    const { created, updated, deleted } = await replaceCourseContentForCourse(
      course.courseNumber,
      items,
    );
    itemsCreated += created;
    itemsUpdated += updated;
    itemsDeleted += deleted;
  }

  return {
    sourceFile,
    coursesProcessed: courses.length,
    coursesWithContent,
    itemsCreated,
    itemsUpdated,
    itemsDeleted,
  };
}

/**
 * Discord-Admin-Einstiegspunkt fuer den Kursinhalte-Import
 * (`/setup-kursinhalte-importieren`). ADMIN-only (isServerAdmin()) - analog
 * zum Standort- und Kursplan-Import ist die Kursinhalte-Pflege eine
 * organisationsweite Verwaltungsangelegenheit, keine Klassenleitungs-Aufgabe.
 */
export async function importCourseContentAsAdmin(
  guildConfig: GuildConfig,
  member: GuildMember,
  actorDiscordId: string,
  sourceFile: string = DEFAULT_COURSE_CONTENT_SOURCE_FILE,
): Promise<CourseContentImportSummary> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen Kursinhalte importieren.');
  }

  const summary = await importCourseContentFromFile(sourceFile);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'courseContent.import',
    metadata: { ...summary },
  });

  return summary;
}

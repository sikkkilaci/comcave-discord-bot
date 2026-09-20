import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getOrCreateClass } from '../repositories/classRepository.js';
import { upsertCourseEntry, upsertCourseSpecialDay } from '../repositories/coursePlanRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { parseIsoDateOnly } from '../utils/dateTime.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Bekannte Kursplan-Quelldateien je Klasse (repo-relative Pfade). Aktuell nur
 * Klasse A - eine spaetere eigene Quelle fuer B/C ist ausschliesslich ein
 * neuer Eintrag hier, keine Code-/Modelaenderung (siehe ARCHITECTURE.md).
 */
export const COURSE_PLAN_SOURCE_FILES: Partial<Record<ClassName, string>> = {
  A: 'data/course-plans/0002_KALENDER_ABLAUF_KW_preview.html',
};

function resolveSourceFilePath(relativePath: string): string {
  return path.join(PROJECT_ROOT, relativePath);
}

export interface ParsedCourseEntry {
  courseNumber: string;
  title: string;
  trainer: string | null;
  startDate: Date;
  endDate: Date;
}

export interface ParsedSpecialDay {
  label: string;
  startDate: Date;
  endDate: Date;
}

export interface ParsedCoursePlan {
  courses: ParsedCourseEntry[];
  specialDays: ParsedSpecialDay[];
}

const COURSE_ENTRY_PATTERN =
  /\{id:"([^"]*)",name:"([^"]*)",start:"([^"]*)",end:"([^"]*)",trainer:"([^"]*)"\}/g;
const SPECIAL_DAY_PATTERN = /\{start:"([^"]*)",end:"([^"]*)",label:"([^"]*)"\}/g;

/**
 * Extrahiert den Inhalt eines `const <varName> = [ ... ];`-Arrays aus dem
 * `<script>`-Block der Quell-HTML. Bewusst kein `eval()`/keine generische
 * JS-Auswertung (Sicherheitsrisiko und unnoetig maechtig fuer ein fest
 * bekanntes, einfaches Datenformat) - stattdessen ein gezielter, auf genau
 * dieses Quellformat zugeschnittener Parser, der bei einer strukturellen
 * Abweichung laut fehlschlaegt statt still unvollstaendige Daten zu uebernehmen.
 */
function extractArrayLiteral(html: string, varName: string): string {
  const pattern = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const match = pattern.exec(html);
  if (!match) {
    throw new ValidationError(
      `Konnte das Array "${varName}" nicht in der Quelldatei finden - unerwartetes Format.`,
    );
  }
  return match[1] ?? '';
}

/** Wandelt einen leeren Trainer-String (Quellformat) in `null` um - Konvention wie ueberall sonst im Projekt. */
function normalizeTrainer(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

/**
 * Parst die strukturierten Kursplan-Daten aus der versionierten Quell-HTML.
 * Reine Funktion ohne Datei-/DB-Zugriff, daher direkt und ohne Testdatei
 * testbar. Nimmt aus der Quelle ausschliesslich vorhandene Werte auf - es
 * werden keine Daten erfunden oder ergaenzt.
 */
export function parseCoursePlanHtml(html: string): ParsedCoursePlan {
  const coursesBlock = extractArrayLiteral(html, 'courses');
  const specialBlock = extractArrayLiteral(html, 'special');

  const expectedCourseCount = (coursesBlock.match(/\{id:/g) ?? []).length;
  const courses: ParsedCourseEntry[] = [...coursesBlock.matchAll(COURSE_ENTRY_PATTERN)].map(
    (match) => ({
      courseNumber: match[1] ?? '',
      title: match[2] ?? '',
      trainer: normalizeTrainer(match[5] ?? ''),
      startDate: parseIsoDateOnly(match[3] ?? ''),
      endDate: parseIsoDateOnly(match[4] ?? ''),
    }),
  );
  if (courses.length !== expectedCourseCount) {
    throw new ValidationError(
      `Kursplan-Quelle konnte nicht vollstaendig geparst werden (erwartet ${expectedCourseCount}, ` +
        `erkannt ${courses.length}) - unerwartetes Format, Import abgebrochen statt unvollstaendiger Daten.`,
    );
  }

  const expectedSpecialCount = (specialBlock.match(/\{start:/g) ?? []).length;
  const specialDays: ParsedSpecialDay[] = [...specialBlock.matchAll(SPECIAL_DAY_PATTERN)].map(
    (match) => ({
      startDate: parseIsoDateOnly(match[1] ?? ''),
      endDate: parseIsoDateOnly(match[2] ?? ''),
      label: match[3] ?? '',
    }),
  );
  if (specialDays.length !== expectedSpecialCount) {
    throw new ValidationError(
      `Kursplan-Quelle (besondere Termine) konnte nicht vollstaendig geparst werden (erwartet ` +
        `${expectedSpecialCount}, erkannt ${specialDays.length}) - Import abgebrochen.`,
    );
  }

  return { courses, specialDays };
}

export interface CoursePlanImportSummary {
  sourceFile: string;
  coursesCreated: number;
  coursesUpdated: number;
  specialDaysCreated: number;
  specialDaysUpdated: number;
}

/**
 * Liest die Quelldatei ein, parst sie und schreibt die enthaltenen Kurse/
 * besonderen Termine fuer die angegebene Klasse (idempotent ueber
 * upsertCourseEntry()/upsertCourseSpecialDay()). Reiner Datenimport ohne
 * Berechtigungspruefung - Vertrauensgrenze wie bei einem Repository, gedacht
 * fuer den Aufruf sowohl aus dem CLI-Seed-Skript (src/scripts/importCoursePlan.ts,
 * kein Discord-Kontext vorhanden) als auch aus importCoursePlanForClass()
 * unten (Discord-Admin-Command, MIT Berechtigungspruefung).
 */
export async function importCoursePlanFromFile(
  guildId: string,
  classId: string,
  sourceFile: string,
  createdByDiscordId: string,
): Promise<CoursePlanImportSummary> {
  const html = await readFile(resolveSourceFilePath(sourceFile), 'utf-8');
  const parsed = parseCoursePlanHtml(html);

  let coursesCreated = 0;
  let coursesUpdated = 0;
  for (const course of parsed.courses) {
    const { created } = await upsertCourseEntry({
      guildId,
      classId,
      courseNumber: course.courseNumber,
      title: course.title,
      trainer: course.trainer,
      startDate: course.startDate,
      endDate: course.endDate,
      sourceFile,
      createdByDiscordId,
    });
    if (created) coursesCreated += 1;
    else coursesUpdated += 1;
  }

  let specialDaysCreated = 0;
  let specialDaysUpdated = 0;
  for (const day of parsed.specialDays) {
    const { created } = await upsertCourseSpecialDay({
      guildId,
      classId,
      label: day.label,
      startDate: day.startDate,
      endDate: day.endDate,
      sourceFile,
    });
    if (created) specialDaysCreated += 1;
    else specialDaysUpdated += 1;
  }

  return { sourceFile, coursesCreated, coursesUpdated, specialDaysCreated, specialDaysUpdated };
}

export interface CoursePlanImportResult extends CoursePlanImportSummary {
  className: ClassName;
}

/**
 * Discord-Admin-Einstiegspunkt fuer den Kursplan-Import (`/kursplan-importieren`).
 * Bewusst ADMIN-only (isServerAdmin(), nicht assertClassManagementAccess()) -
 * anders als das taegliche Verwalten von Pruefungen/Terminen ist das
 * Einspielen der offiziellen Kursplandaten hier als Administrations-Aufgabe
 * vorgesehen (siehe Hinweistext fuer B/C: "...an die Administration
 * uebermittelt werden koennen"), nicht Teil der Klassenleitungs-Rechte.
 */
export async function importCoursePlanForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  actorDiscordId: string,
): Promise<CoursePlanImportResult> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen Kursplandaten importieren.');
  }

  const sourceFile = COURSE_PLAN_SOURCE_FILES[className];
  if (!sourceFile) {
    throw new ValidationError(
      `Fuer Klasse ${className} ist noch keine Kursplan-Quelldatei hinterlegt.`,
    );
  }

  const klasse = await getOrCreateClass(guildConfig.id, className);
  const summary = await importCoursePlanFromFile(
    guildConfig.id,
    klasse.id,
    sourceFile,
    actorDiscordId,
  );

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'coursePlan.import',
    metadata: { className, ...summary },
  });

  return { ...summary, className };
}

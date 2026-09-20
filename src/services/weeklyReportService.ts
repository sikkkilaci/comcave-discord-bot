import type { GuildConfig, WeeklyReport } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import {
  createWeeklyReport as createWeeklyReportRow,
  deleteWeeklyReport as deleteWeeklyReportRow,
  getWeeklyReportById,
  listWeeklyReportsByClassId,
  updateWeeklyReport as updateWeeklyReportRow,
  type WeeklyReportUpdate,
} from '../repositories/weeklyReportRepository.js';
import { clearLearningMaterialLinksTo } from '../repositories/learningMaterialRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { parseGermanDate } from '../utils/dateTime.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

export interface WeeklyReportCreateInput {
  kalenderwoche: number;
  zeitraumStart: string;
  zeitraumEnde: string;
  themen: string;
  lernfortschritt: string;
  hinweise: string;
}

export interface WeeklyReportEditInput {
  kalenderwoche?: number;
  zeitraumStart?: string;
  zeitraumEnde?: string;
  themen?: string;
  lernfortschritt?: string;
  hinweise?: string;
}

function requireNonEmpty(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} darf nicht leer sein.`);
  }
  return trimmed;
}

function validateCalendarWeek(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 53) {
    throw new ValidationError('Kalenderwoche muss eine ganze Zahl zwischen 1 und 53 sein.');
  }
  return value;
}

function validatePeriod(periodStart: Date, periodEnd: Date): void {
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new ValidationError('Das Ende des Zeitraums darf nicht vor dessen Beginn liegen.');
  }
}

/**
 * Legt einen Wochenbericht (Berichtsheft-Grundlage) fuer eine Klasse an. Nur
 * Admin oder die Klassenleitung genau dieser Klasse duerfen das
 * (assertClassManagementAccess()) - dieselbe zentrale Pruefung wie bei
 * Pruefungen/Terminen/Tagesberichten, keine zweite Permission-Logik.
 */
export async function createWeeklyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  input: WeeklyReportCreateInput,
  actorDiscordId: string,
): Promise<WeeklyReport> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const calendarWeek = validateCalendarWeek(input.kalenderwoche);
  const periodStart = parseGermanDate(input.zeitraumStart);
  const periodEnd = parseGermanDate(input.zeitraumEnde);
  validatePeriod(periodStart, periodEnd);
  const topics = requireNonEmpty(input.themen, 'Behandelte Themen');
  const progress = requireNonEmpty(input.lernfortschritt, 'Lernfortschritt/Inhalte');
  const notes = requireNonEmpty(input.hinweise, 'Besondere Hinweise');

  const report = await createWeeklyReportRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    year: periodStart.getFullYear(),
    calendarWeek,
    periodStart,
    periodEnd,
    topics,
    progress,
    notes,
    createdByDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'weeklyReport.create',
    metadata: { reportId: report.id, className, calendarWeek, year: report.year },
  });

  return report;
}

/**
 * Bearbeitet einen bestehenden Wochenbericht. Die Berechtigung wird gegen die
 * Klasse geprueft, die tatsaechlich in der Datenbank zum Bericht gehoert
 * (`report.classId` -> getClassById()) - niemals gegen einen vom Aufrufer
 * behaupteten Klassennamen.
 */
export async function updateWeeklyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  reportId: string,
  input: WeeklyReportEditInput,
  actorDiscordId: string,
): Promise<WeeklyReport> {
  const report = await getWeeklyReportById(guildConfig.id, reportId);
  if (!report) {
    throw new NotFoundError('Dieser Wochenbericht wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, report.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const data: WeeklyReportUpdate = {};
  if (input.kalenderwoche !== undefined) {
    data.calendarWeek = validateCalendarWeek(input.kalenderwoche);
  }
  if (input.zeitraumStart !== undefined || input.zeitraumEnde !== undefined) {
    if (input.zeitraumStart === undefined || input.zeitraumEnde === undefined) {
      throw new ValidationError(
        'Zeitraum-Start und Zeitraum-Ende muessen gemeinsam angegeben werden, um den Zeitraum zu aendern.',
      );
    }
    const periodStart = parseGermanDate(input.zeitraumStart);
    const periodEnd = parseGermanDate(input.zeitraumEnde);
    validatePeriod(periodStart, periodEnd);
    data.periodStart = periodStart;
    data.periodEnd = periodEnd;
    data.year = periodStart.getFullYear();
  }
  if (input.themen !== undefined) {
    data.topics = requireNonEmpty(input.themen, 'Behandelte Themen');
  }
  if (input.lernfortschritt !== undefined) {
    data.progress = requireNonEmpty(input.lernfortschritt, 'Lernfortschritt/Inhalte');
  }
  if (input.hinweise !== undefined) {
    data.notes = requireNonEmpty(input.hinweise, 'Besondere Hinweise');
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updateWeeklyReportRow(reportId, data);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'weeklyReport.update',
    metadata: { reportId, className: klasse.name, changedFields: Object.keys(data) },
  });

  return updated;
}

/** Loescht einen Wochenbericht - Berechtigungspruefung wie bei updateWeeklyReportForClass(). */
export async function deleteWeeklyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  reportId: string,
  actorDiscordId: string,
): Promise<WeeklyReport> {
  const report = await getWeeklyReportById(guildConfig.id, reportId);
  if (!report) {
    throw new NotFoundError('Dieser Wochenbericht wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, report.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  await deleteWeeklyReportRow(reportId);
  // Verwaiste Verknuepfungen aufloesen, da linkedType/linkedId kein DB-Fremdschluessel ist.
  await clearLearningMaterialLinksTo('WEEKLY_REPORT', reportId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'weeklyReport.delete',
    metadata: {
      reportId,
      className: klasse.name,
      calendarWeek: report.calendarWeek,
      year: report.year,
    },
  });

  return report;
}

export interface WeeklyReportListResult {
  className: ClassName;
  reports: WeeklyReport[];
}

/**
 * Listet die Wochenberichte einer Klasse. Ohne explizite Klassenangabe wird
 * die eigene Klasse des Aufrufers verwendet. Lesezugriff ist erlaubt fuer
 * Admin, die Klassenleitung dieser Klasse ODER ein Mitglied der Klasse selbst
 * (assertClassReadAccess()) - jede andere Klasse wird verweigert.
 */
export async function listWeeklyReportsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<WeeklyReportListResult> {
  const memberRow = await getMemberWithClass(guildConfig.id, member.id);
  const ownClassName = (memberRow?.class?.name as ClassName | undefined) ?? null;
  const targetName = requestedClassName ?? ownClassName;

  if (!targetName) {
    throw new ValidationError(
      'Du bist noch keiner Klasse zugeordnet. Bitte gib eine Klasse an oder waehle zuerst eine ' +
        'in #wo-bin-ich.',
    );
  }

  const klasse = await getClassByName(guildConfig.id, targetName);
  if (!klasse) {
    throw new NotFoundError(`Klasse ${targetName} ist noch nicht konfiguriert.`);
  }

  assertClassReadAccess(member, guildConfig, klasse, memberRow?.classId ?? null);

  const reports = await listWeeklyReportsByClassId(klasse.id);
  return { className: targetName, reports };
}

import type { DailyReport, GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import {
  createDailyReport as createDailyReportRow,
  deleteDailyReport as deleteDailyReportRow,
  getDailyReportById,
  listDailyReportsByClassId,
  updateDailyReport as updateDailyReportRow,
  type DailyReportUpdate,
} from '../repositories/dailyReportRepository.js';
import { clearLearningMaterialLinksTo } from '../repositories/learningMaterialRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { parseGermanDate } from '../utils/dateTime.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

export interface DailyReportCreateInput {
  datum: string;
  themen: string;
  lerninhalte: string;
  hinweise: string;
  lernmaterialien?: string | null;
}

export interface DailyReportEditInput {
  datum?: string;
  themen?: string;
  lerninhalte?: string;
  hinweise?: string;
  lernmaterialien?: string;
}

function requireNonEmpty(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} darf nicht leer sein.`);
  }
  return trimmed;
}

/**
 * Legt einen Tagesbericht (Berichtsheft-Grundlage) fuer eine Klasse an. Nur
 * Admin oder die Klassenleitung genau dieser Klasse duerfen das
 * (assertClassManagementAccess()) - dieselbe zentrale Pruefung wie bei
 * Pruefungen/Terminen, keine zweite Permission-Logik.
 */
export async function createDailyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  input: DailyReportCreateInput,
  actorDiscordId: string,
): Promise<DailyReport> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const date = parseGermanDate(input.datum);
  const topics = requireNonEmpty(input.themen, 'Behandelte Themen');
  const content = requireNonEmpty(input.lerninhalte, 'Lerninhalte');
  const notes = requireNonEmpty(input.hinweise, 'Besondere Hinweise');
  const relatedMaterials = input.lernmaterialien?.trim() ? input.lernmaterialien.trim() : null;

  const report = await createDailyReportRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    date,
    topics,
    content,
    notes,
    relatedMaterials,
    createdByDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'dailyReport.create',
    metadata: { reportId: report.id, className, date: date.toISOString() },
  });

  return report;
}

/**
 * Bearbeitet einen bestehenden Tagesbericht. Die Berechtigung wird gegen die
 * Klasse geprueft, die tatsaechlich in der Datenbank zum Bericht gehoert
 * (`report.classId` -> getClassById()) - niemals gegen einen vom Aufrufer
 * behaupteten Klassennamen. Das verhindert, dass eine manipulierte
 * Berichts-ID Zugriff auf eine fremde Klasse verschaffen koennte.
 */
export async function updateDailyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  reportId: string,
  input: DailyReportEditInput,
  actorDiscordId: string,
): Promise<DailyReport> {
  const report = await getDailyReportById(guildConfig.id, reportId);
  if (!report) {
    throw new NotFoundError('Dieser Tagesbericht wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, report.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const data: DailyReportUpdate = {};
  if (input.datum !== undefined) {
    data.date = parseGermanDate(input.datum);
  }
  if (input.themen !== undefined) {
    data.topics = requireNonEmpty(input.themen, 'Behandelte Themen');
  }
  if (input.lerninhalte !== undefined) {
    data.content = requireNonEmpty(input.lerninhalte, 'Lerninhalte');
  }
  if (input.hinweise !== undefined) {
    data.notes = requireNonEmpty(input.hinweise, 'Besondere Hinweise');
  }
  if (input.lernmaterialien !== undefined) {
    data.relatedMaterials = input.lernmaterialien.trim() ? input.lernmaterialien.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updateDailyReportRow(reportId, data);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'dailyReport.update',
    metadata: { reportId, className: klasse.name, changedFields: Object.keys(data) },
  });

  return updated;
}

/** Loescht einen Tagesbericht - Berechtigungspruefung wie bei updateDailyReportForClass(). */
export async function deleteDailyReportForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  reportId: string,
  actorDiscordId: string,
): Promise<DailyReport> {
  const report = await getDailyReportById(guildConfig.id, reportId);
  if (!report) {
    throw new NotFoundError('Dieser Tagesbericht wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, report.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  await deleteDailyReportRow(reportId);
  // Verwaiste Verknuepfungen aufloesen, da linkedType/linkedId kein DB-Fremdschluessel ist.
  await clearLearningMaterialLinksTo('DAILY_REPORT', reportId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'dailyReport.delete',
    metadata: { reportId, className: klasse.name, date: report.date.toISOString() },
  });

  return report;
}

export interface DailyReportListResult {
  className: ClassName;
  reports: DailyReport[];
}

/**
 * Listet die Tagesberichte einer Klasse. Ohne explizite Klassenangabe wird
 * die eigene Klasse des Aufrufers verwendet (`Member.classId`). Lesezugriff
 * ist erlaubt fuer Admin, die Klassenleitung dieser Klasse ODER ein Mitglied
 * der Klasse selbst (assertClassReadAccess()) - jede andere Klasse wird
 * verweigert, auch wenn sie explizit angegeben wird.
 */
export async function listDailyReportsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<DailyReportListResult> {
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

  const reports = await listDailyReportsByClassId(klasse.id);
  return { className: targetName, reports };
}

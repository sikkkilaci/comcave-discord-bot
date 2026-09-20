import type { Exam, GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import {
  createExam as createExamRow,
  deleteExam as deleteExamRow,
  getExamById,
  listExamsByClassId,
  updateExam as updateExamRow,
  type ExamUpdate,
} from '../repositories/examRepository.js';
import { clearLearningMaterialLinksTo } from '../repositories/learningMaterialRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { parseGermanDateTime } from '../utils/dateTime.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

export interface ExamCreateInput {
  fach: string;
  beschreibung: string;
  lernhinweise?: string | null;
  datum: string;
  uhrzeit: string;
}

export interface ExamEditInput {
  fach?: string;
  beschreibung?: string;
  lernhinweise?: string;
  datum?: string;
  uhrzeit?: string;
}

function requireNonEmpty(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} darf nicht leer sein.`);
  }
  return trimmed;
}

/**
 * Legt eine Pruefung fuer eine Klasse an. Nur Admin oder die Klassenleitung
 * genau dieser Klasse duerfen das (assertClassManagementAccess()) - dieselbe
 * zentrale Pruefung wie bei den privaten Klassenbereichen, keine zweite
 * Permission-Logik.
 */
export async function createExamForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  input: ExamCreateInput,
  actorDiscordId: string,
): Promise<Exam> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const subject = requireNonEmpty(input.fach, 'Fach/Thema');
  const description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  const studyNotes = input.lernhinweise?.trim() ? input.lernhinweise.trim() : null;
  const scheduledAt = parseGermanDateTime(input.datum, input.uhrzeit);

  const exam = await createExamRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    subject,
    description,
    studyNotes,
    scheduledAt,
    createdByDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'exam.create',
    metadata: { examId: exam.id, className, subject, scheduledAt: scheduledAt.toISOString() },
  });

  return exam;
}

/**
 * Bearbeitet eine bestehende Pruefung. Die Berechtigung wird gegen die
 * Klasse geprueft, die tatsaechlich in der Datenbank zur Pruefung gehoert
 * (`exam.classId` -> getClassById()) - niemals gegen einen vom Aufrufer
 * behaupteten Klassennamen. Das verhindert, dass eine manipulierte
 * Pruefungs-ID Zugriff auf eine fremde Klasse verschaffen koennte.
 */
export async function updateExamForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  examId: string,
  input: ExamEditInput,
  actorDiscordId: string,
): Promise<Exam> {
  const exam = await getExamById(guildConfig.id, examId);
  if (!exam) {
    throw new NotFoundError('Diese Pruefung wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, exam.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const data: ExamUpdate = {};
  if (input.fach !== undefined) {
    data.subject = requireNonEmpty(input.fach, 'Fach/Thema');
  }
  if (input.beschreibung !== undefined) {
    data.description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  }
  if (input.lernhinweise !== undefined) {
    data.studyNotes = input.lernhinweise.trim() ? input.lernhinweise.trim() : null;
  }
  if (input.datum !== undefined || input.uhrzeit !== undefined) {
    if (input.datum === undefined || input.uhrzeit === undefined) {
      throw new ValidationError(
        'Datum und Uhrzeit muessen gemeinsam angegeben werden, um den Zeitpunkt zu aendern.',
      );
    }
    data.scheduledAt = parseGermanDateTime(input.datum, input.uhrzeit);
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updateExamRow(examId, data);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'exam.update',
    metadata: { examId, className: klasse.name, changedFields: Object.keys(data) },
  });

  return updated;
}

/** Loescht eine Pruefung - Berechtigungspruefung wie bei updateExamForClass(). */
export async function deleteExamForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  examId: string,
  actorDiscordId: string,
): Promise<Exam> {
  const exam = await getExamById(guildConfig.id, examId);
  if (!exam) {
    throw new NotFoundError('Diese Pruefung wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, exam.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  await deleteExamRow(examId);
  // Verwaiste Verknuepfungen aufloesen, da linkedType/linkedId kein DB-Fremdschluessel ist.
  await clearLearningMaterialLinksTo('EXAM', examId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'exam.delete',
    metadata: { examId, className: klasse.name, subject: exam.subject },
  });

  return exam;
}

export interface ExamListResult {
  className: ClassName;
  exams: Exam[];
}

/**
 * Listet die Pruefungen einer Klasse. Ohne explizite Klassenangabe wird die
 * eigene Klasse des Aufrufers verwendet (`Member.classId`). Lesezugriff ist
 * erlaubt fuer Admin, die Klassenleitung dieser Klasse ODER ein Mitglied der
 * Klasse selbst (assertClassReadAccess()) - jede andere Klasse wird
 * verweigert, auch wenn sie explizit angegeben wird.
 */
export async function listExamsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<ExamListResult> {
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

  const exams = await listExamsByClassId(klasse.id);
  return { className: targetName, exams };
}

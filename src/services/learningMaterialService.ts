import type { GuildConfig, LearningMaterial } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import { getExamById } from '../repositories/examRepository.js';
import { getDailyReportById } from '../repositories/dailyReportRepository.js';
import { getWeeklyReportById } from '../repositories/weeklyReportRepository.js';
import {
  createLearningMaterial as createLearningMaterialRow,
  deleteLearningMaterial as deleteLearningMaterialRow,
  getLearningMaterialById,
  listLearningMaterialsByClassId,
  updateLearningMaterial as updateLearningMaterialRow,
  type LearningMaterialUpdate,
} from '../repositories/learningMaterialRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import {
  learningMaterialCategorySchema,
  learningMaterialLinkTypeSchema,
  type ClassName,
} from '../types/domain.js';

export interface LearningMaterialAttachmentInput {
  url: string;
  name: string;
  contentType: string | null;
}

export interface LearningMaterialCreateInput {
  titel: string;
  beschreibung: string;
  fach: string;
  kategorie: string;
  url?: string | null;
  anhang?: LearningMaterialAttachmentInput | null;
  verknuepfungTyp?: string | null;
  verknuepfungId?: string | null;
}

export interface LearningMaterialEditInput {
  titel?: string;
  beschreibung?: string;
  fach?: string;
  kategorie?: string;
  url?: string;
  anhang?: LearningMaterialAttachmentInput;
  verknuepfungTyp?: string;
  verknuepfungId?: string;
}

function requireNonEmpty(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} darf nicht leer sein.`);
  }
  return trimmed;
}

function validateCategory(value: string): string {
  const parsed = learningMaterialCategorySchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Ungueltige Kategorie: ${value}.`);
  }
  return parsed.data;
}

interface ResolvedLink {
  linkedType: string;
  linkedId: string;
}

/**
 * Prueft eine optionale Verknuepfung mit einer Pruefung oder einem Bericht:
 * Typ und ID muessen gemeinsam angegeben werden, der referenzierte Datensatz
 * muss existieren UND zur selben Klasse gehoeren wie das Lernmaterial selbst -
 * fail-closed gegen eine manipulierte Verknuepfungs-ID, die sonst auf eine
 * fremde Klasse verweisen koennte.
 */
async function resolveLink(
  guildId: string,
  classId: string,
  linkedType: string | undefined,
  linkedId: string | undefined,
): Promise<ResolvedLink | null> {
  if (linkedType === undefined && linkedId === undefined) {
    return null;
  }
  if (linkedType === undefined || linkedId === undefined) {
    throw new ValidationError(
      'Verknuepfungstyp und Verknuepfungs-ID muessen gemeinsam angegeben werden.',
    );
  }

  const parsedType = learningMaterialLinkTypeSchema.safeParse(linkedType);
  if (!parsedType.success) {
    throw new ValidationError(`Ungueltiger Verknuepfungstyp: ${linkedType}.`);
  }

  let belongsToClass = false;
  if (parsedType.data === 'EXAM') {
    const exam = await getExamById(guildId, linkedId);
    belongsToClass = exam?.classId === classId;
  } else if (parsedType.data === 'DAILY_REPORT') {
    const report = await getDailyReportById(guildId, linkedId);
    belongsToClass = report?.classId === classId;
  } else {
    const report = await getWeeklyReportById(guildId, linkedId);
    belongsToClass = report?.classId === classId;
  }

  if (!belongsToClass) {
    throw new ValidationError(
      'Die angegebene Verknuepfung wurde nicht gefunden oder gehoert nicht zu dieser Klasse.',
    );
  }

  return { linkedType: parsedType.data, linkedId };
}

/**
 * Legt Lernmaterial fuer eine Klasse an. Nur Admin oder die Klassenleitung
 * genau dieser Klasse duerfen das (assertClassManagementAccess()) - dieselbe
 * zentrale Pruefung wie bei Pruefungen/Terminen/Berichten, keine zweite
 * Permission-Logik.
 */
export async function createLearningMaterialForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  input: LearningMaterialCreateInput,
  actorDiscordId: string,
): Promise<LearningMaterial> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const title = requireNonEmpty(input.titel, 'Titel');
  const description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  const subject = requireNonEmpty(input.fach, 'Fach/Thema');
  const category = validateCategory(input.kategorie);
  const link = await resolveLink(
    guildConfig.id,
    klasse.id,
    input.verknuepfungTyp ?? undefined,
    input.verknuepfungId ?? undefined,
  );

  const material = await createLearningMaterialRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    title,
    description,
    subject,
    category,
    url: input.url?.trim() ? input.url.trim() : null,
    attachmentUrl: input.anhang?.url ?? null,
    attachmentName: input.anhang?.name ?? null,
    attachmentContentType: input.anhang?.contentType ?? null,
    linkedType: link?.linkedType ?? null,
    linkedId: link?.linkedId ?? null,
    createdByDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'learningMaterial.create',
    metadata: { materialId: material.id, className, title, category },
  });

  return material;
}

/**
 * Bearbeitet bestehendes Lernmaterial. Die Berechtigung wird gegen die
 * Klasse geprueft, die tatsaechlich in der Datenbank zum Material gehoert
 * (`material.classId` -> getClassById()) - niemals gegen einen vom Aufrufer
 * behaupteten Klassennamen. Das verhindert, dass eine manipulierte
 * Material-ID Zugriff auf eine fremde Klasse verschaffen koennte.
 */
export async function updateLearningMaterialForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  materialId: string,
  input: LearningMaterialEditInput,
  actorDiscordId: string,
): Promise<LearningMaterial> {
  const material = await getLearningMaterialById(guildConfig.id, materialId);
  if (!material) {
    throw new NotFoundError('Dieses Lernmaterial wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, material.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const data: LearningMaterialUpdate = {};
  if (input.titel !== undefined) {
    data.title = requireNonEmpty(input.titel, 'Titel');
  }
  if (input.beschreibung !== undefined) {
    data.description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  }
  if (input.fach !== undefined) {
    data.subject = requireNonEmpty(input.fach, 'Fach/Thema');
  }
  if (input.kategorie !== undefined) {
    data.category = validateCategory(input.kategorie);
  }
  if (input.url !== undefined) {
    data.url = input.url.trim() ? input.url.trim() : null;
  }
  if (input.anhang !== undefined) {
    data.attachmentUrl = input.anhang.url;
    data.attachmentName = input.anhang.name;
    data.attachmentContentType = input.anhang.contentType;
  }
  if (input.verknuepfungTyp !== undefined || input.verknuepfungId !== undefined) {
    const link = await resolveLink(
      guildConfig.id,
      material.classId,
      input.verknuepfungTyp,
      input.verknuepfungId,
    );
    data.linkedType = link?.linkedType ?? null;
    data.linkedId = link?.linkedId ?? null;
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updateLearningMaterialRow(materialId, data);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'learningMaterial.update',
    metadata: { materialId, className: klasse.name, changedFields: Object.keys(data) },
  });

  return updated;
}

/** Loescht Lernmaterial - Berechtigungspruefung wie bei updateLearningMaterialForClass(). */
export async function deleteLearningMaterialForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  materialId: string,
  actorDiscordId: string,
): Promise<LearningMaterial> {
  const material = await getLearningMaterialById(guildConfig.id, materialId);
  if (!material) {
    throw new NotFoundError('Dieses Lernmaterial wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, material.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  await deleteLearningMaterialRow(materialId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'learningMaterial.delete',
    metadata: { materialId, className: klasse.name, title: material.title },
  });

  return material;
}

export interface LearningMaterialListResult {
  className: ClassName;
  materials: LearningMaterial[];
}

/**
 * Listet das Lernmaterial einer Klasse. Ohne explizite Klassenangabe wird
 * die eigene Klasse des Aufrufers verwendet (`Member.classId`). Lesezugriff
 * ist erlaubt fuer Admin, die Klassenleitung dieser Klasse ODER ein Mitglied
 * der Klasse selbst (assertClassReadAccess()) - jede andere Klasse wird
 * verweigert, auch wenn sie explizit angegeben wird.
 */
export async function listLearningMaterialsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<LearningMaterialListResult> {
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

  const materials = await listLearningMaterialsByClassId(klasse.id);
  return { className: targetName, materials };
}

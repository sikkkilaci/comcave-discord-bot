import type { GuildConfig, StudyGroup } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import {
  addStudyGroupMember,
  closeStudyGroup as closeStudyGroupRow,
  countStudyGroupMembers,
  createStudyGroup as createStudyGroupRow,
  getStudyGroupById,
  getStudyGroupMembership,
  listActiveStudyGroupsByClassId,
  listStudyGroupMembers,
  listStudyGroupsByClassId,
  removeStudyGroupMember,
} from '../repositories/studyGroupRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
  isClassLeadOf,
  isServerAdmin,
} from '../permissions/checkPermission.js';
import { NotFoundError, PermissionError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

const MAX_PARTICIPANTS_LIMIT = 100;

function requireNonEmptyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ValidationError('Der Name der Lerngruppe darf nicht leer sein.');
  }
  if (trimmed.length > 100) {
    throw new ValidationError('Der Name der Lerngruppe darf hoechstens 100 Zeichen lang sein.');
  }
  return trimmed;
}

function validateMaxParticipants(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PARTICIPANTS_LIMIT) {
    throw new ValidationError(
      `Das Teilnehmerlimit muss eine ganze Zahl zwischen 1 und ${MAX_PARTICIPANTS_LIMIT} sein.`,
    );
  }
  return value;
}

/**
 * Loest eine Lerngruppe fail-closed auf: immer per `guildConfig.id` gescoped
 * (verhindert Zugriff auf eine Gruppe einer fremden Guild ueber eine
 * manipulierte ID), Klasse immer aus dem gespeicherten `group.classId`
 * aufgeloest statt aus einem Aufrufer-Parameter.
 */
async function resolveStudyGroupAndClass(guildId: string, studyGroupId: string) {
  const group = await getStudyGroupById(guildId, studyGroupId);
  if (!group) {
    throw new NotFoundError('Diese Lerngruppe wurde nicht gefunden.');
  }
  const klasse = await getClassById(guildId, group.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  return { group, klasse };
}

function assertGroupIsActive(group: StudyGroup): void {
  if (!group.isActive) {
    throw new ValidationError('Diese Lerngruppe ist bereits geschlossen.');
  }
}

export interface StudyGroupCreateInput {
  name: string;
  maxParticipants?: number | null;
}

/**
 * Legt eine Lerngruppe fuer eine Klasse an. Lesezugriff-Berechtigung
 * (assertClassReadAccess()) statt Verwaltungs-Berechtigung: jedes verifizierte
 * Mitglied der Klasse selbst darf eine Gruppe gruenden, nicht nur Admin/
 * Klassenleitung - dieselbe Bedingung, die auch das Lesen von Kursplan/
 * Pruefungen der eigenen Klasse erlaubt. Der Ersteller wird automatisch als
 * erstes Mitglied aufgenommen.
 */
export async function createStudyGroupForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
  input: StudyGroupCreateInput,
  actorDiscordId: string,
): Promise<StudyGroup> {
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
    throw new ValidationError(`Klasse ${targetName} ist noch nicht konfiguriert.`);
  }
  assertClassReadAccess(member, guildConfig, klasse, memberRow?.classId ?? null);

  const name = requireNonEmptyName(input.name);
  const maxParticipants = validateMaxParticipants(input.maxParticipants ?? null);

  const group = await createStudyGroupRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    name,
    createdByDiscordId: actorDiscordId,
    maxParticipants,
  });

  await addStudyGroupMember({
    guildId: guildConfig.id,
    classId: klasse.id,
    studyGroupId: group.id,
    memberDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'studyGroup.create',
    metadata: { studyGroupId: group.id, name, className: klasse.name, maxParticipants },
  });

  return group;
}

export interface StudyGroupListItem {
  group: StudyGroup;
  memberCount: number;
}

export interface StudyGroupListResult {
  className: ClassName;
  groups: StudyGroupListItem[];
  /** Klassen-Sprachkanal, in dem sich Lerngruppen der Klasse treffen (siehe "Voice-Konzept" in ARCHITECTURE.md). */
  voiceChannelId: string | null;
}

/** Listet aktive Lerngruppen einer Klasse - Lesezugriff wie bei anderen klassenbezogenen Anzeigen. */
export async function listStudyGroupsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<StudyGroupListResult> {
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

  const groups = await listActiveStudyGroupsByClassId(klasse.id);
  const groupsWithCounts = await Promise.all(
    groups.map(async (group) => ({ group, memberCount: await countStudyGroupMembers(group.id) })),
  );

  return { className: targetName, groups: groupsWithCounts, voiceChannelId: klasse.voiceChannelId };
}

export interface StudyGroupJoinResult {
  changed: boolean;
  group: StudyGroup;
}

/**
 * Tritt einer Lerngruppe bei. Klasse wird immer aus dem gespeicherten
 * `group.classId` aufgeloest (nie aus einem Aufrufer-Parameter), Zugriff nur
 * fuer Admin, die Klassenleitung dieser Klasse oder ein Mitglied der Klasse
 * selbst (assertClassReadAccess()) - ein Mitglied der Klasse B kann damit
 * niemals einer Gruppe der Klasse A beitreten, auch nicht ueber eine
 * manipulierte Gruppen-ID.
 */
export async function joinStudyGroup(
  guildConfig: GuildConfig,
  member: GuildMember,
  studyGroupId: string,
  actorDiscordId: string,
): Promise<StudyGroupJoinResult> {
  const { group, klasse } = await resolveStudyGroupAndClass(guildConfig.id, studyGroupId);

  const memberRow = await getMemberWithClass(guildConfig.id, member.id);
  assertClassReadAccess(member, guildConfig, klasse, memberRow?.classId ?? null);
  assertGroupIsActive(group);

  const existing = await getStudyGroupMembership(studyGroupId, actorDiscordId);
  if (existing) {
    return { changed: false, group };
  }

  if (group.maxParticipants !== null) {
    const currentCount = await countStudyGroupMembers(studyGroupId);
    if (currentCount >= group.maxParticipants) {
      throw new ValidationError(
        `Die Lerngruppe "${group.name}" ist bereits voll (${currentCount}/${group.maxParticipants} Teilnehmer).`,
      );
    }
  }

  await addStudyGroupMember({
    guildId: guildConfig.id,
    classId: klasse.id,
    studyGroupId,
    memberDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'studyGroup.join',
    metadata: { studyGroupId, name: group.name, className: klasse.name },
  });

  return { changed: true, group };
}

/**
 * Verlaesst eine Lerngruppe (Selbstbedienung - jedes Mitglied kann sich selbst
 * jederzeit entfernen, keine zusaetzliche Berechtigungspruefung noetig, da man
 * nur die eigene Mitgliedschaft loescht).
 */
export async function leaveStudyGroup(
  guildConfig: GuildConfig,
  member: GuildMember,
  studyGroupId: string,
  actorDiscordId: string,
): Promise<StudyGroup> {
  const { group, klasse } = await resolveStudyGroupAndClass(guildConfig.id, studyGroupId);
  assertGroupIsActive(group);

  const membership = await getStudyGroupMembership(studyGroupId, actorDiscordId);
  if (!membership) {
    throw new NotFoundError('Du bist kein Mitglied dieser Lerngruppe.');
  }

  await removeStudyGroupMember(studyGroupId, actorDiscordId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'studyGroup.leave',
    metadata: { studyGroupId, name: group.name, className: klasse.name },
  });

  return group;
}

/**
 * Entfernt ein ANDERES Mitglied aus einer Lerngruppe - Moderationsaktion,
 * ausschliesslich fuer Admin oder die Klassenleitung genau dieser Klasse
 * (assertClassManagementAccess()). Klassenleitung A kann damit niemals ein
 * Mitglied aus einer Gruppe der Klasse B entfernen.
 */
export async function removeStudyGroupMemberByModerator(
  guildConfig: GuildConfig,
  member: GuildMember,
  studyGroupId: string,
  targetDiscordId: string,
  actorDiscordId: string,
): Promise<StudyGroup> {
  const { group, klasse } = await resolveStudyGroupAndClass(guildConfig.id, studyGroupId);
  assertClassManagementAccess(member, guildConfig, klasse);
  assertGroupIsActive(group);

  const membership = await getStudyGroupMembership(studyGroupId, targetDiscordId);
  if (!membership) {
    throw new NotFoundError('Dieses Mitglied gehoert nicht zu dieser Lerngruppe.');
  }

  await removeStudyGroupMember(studyGroupId, targetDiscordId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'studyGroup.memberRemoved',
    targetDiscordId,
    metadata: { studyGroupId, name: group.name, className: klasse.name },
  });

  return group;
}

/**
 * Schliesst eine Lerngruppe. Erlaubt sind Admin, die Klassenleitung dieser
 * Klasse ODER der urspruengliche Ersteller der Gruppe selbst - dieselben
 * beiden Grund-Bedingungen wie in assertClassManagementAccess() (isServerAdmin()/
 * isClassLeadOf()), lediglich um EINE zusaetzliche erlaubte Bedingung ergaenzt
 * (Ersteller darf die selbst gegruendete Gruppe beenden) - keine zweite,
 * parallele Berechtigungslogik, genau wie assertClassReadAccess() bereits
 * dieselben zwei Grund-Bedingungen um die Bedingung "eigene Klasse" ergaenzt.
 * Eine bereits geschlossene Gruppe kann nicht erneut geschlossen werden.
 */
export async function closeStudyGroup(
  guildConfig: GuildConfig,
  member: GuildMember,
  studyGroupId: string,
  actorDiscordId: string,
): Promise<StudyGroup> {
  const { group, klasse } = await resolveStudyGroupAndClass(guildConfig.id, studyGroupId);
  assertGroupIsActive(group);

  const isCreator = group.createdByDiscordId === member.id;
  if (!isServerAdmin(member, guildConfig) && !isClassLeadOf(member, klasse) && !isCreator) {
    throw new PermissionError(
      `Du bist weder Admin noch die Klassenleitung von Klasse ${klasse.name} noch die Ersteller:in ` +
        'dieser Lerngruppe. Nur diese Personen duerfen die Gruppe schliessen.',
    );
  }

  const closed = await closeStudyGroupRow(studyGroupId, actorDiscordId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'studyGroup.close',
    metadata: { studyGroupId, name: group.name, className: klasse.name },
  });

  return closed;
}

export interface StudyGroupStatusItem {
  group: StudyGroup;
  memberDiscordIds: string[];
}

export interface StudyGroupStatusResult {
  className: ClassName;
  groups: StudyGroupStatusItem[];
}

/**
 * Verwaltungssicht fuer Klassenleitung/Admin: alle Lerngruppen einer Klasse
 * (aktiv und geschlossen) inkl. vollstaendiger Mitgliederliste -
 * assertClassManagementAccess() wie bei jeder anderen Verwaltungsfunktion.
 */
export async function getStudyGroupStatusForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
): Promise<StudyGroupStatusResult> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new NotFoundError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const groups = await listStudyGroupsByClassId(klasse.id);
  const groupsWithMembers = await Promise.all(
    groups.map(async (group) => ({
      group,
      memberDiscordIds: (await listStudyGroupMembers(group.id)).map((m) => m.memberDiscordId),
    })),
  );

  return { className, groups: groupsWithMembers };
}

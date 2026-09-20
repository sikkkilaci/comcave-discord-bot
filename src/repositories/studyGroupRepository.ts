import type { StudyGroup, StudyGroupMember } from '@prisma/client';
import { isUniqueConstraintError, prisma } from '../db/client.js';

export interface CreateStudyGroupInput {
  guildId: string;
  classId: string;
  name: string;
  createdByDiscordId: string;
  maxParticipants: number | null;
}

export async function createStudyGroup(input: CreateStudyGroupInput): Promise<StudyGroup> {
  return prisma.studyGroup.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Gruppen-ID nie serveruebergreifend Daten preisgibt. */
export async function getStudyGroupById(
  guildId: string,
  studyGroupId: string,
): Promise<StudyGroup | null> {
  return prisma.studyGroup.findFirst({ where: { id: studyGroupId, guildId } });
}

/** Nur aktive Gruppen, sortiert nach Name - fuer /lerngruppen-anzeigen. */
export async function listActiveStudyGroupsByClassId(classId: string): Promise<StudyGroup[]> {
  return prisma.studyGroup.findMany({
    where: { classId, isActive: true },
    orderBy: { name: 'asc' },
  });
}

/** Alle Gruppen (aktiv und geschlossen) - fuer die Klassenleitungs-/Admin-Uebersicht. */
export async function listStudyGroupsByClassId(classId: string): Promise<StudyGroup[]> {
  return prisma.studyGroup.findMany({
    where: { classId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function closeStudyGroup(
  studyGroupId: string,
  closedByDiscordId: string,
): Promise<StudyGroup> {
  return prisma.studyGroup.update({
    where: { id: studyGroupId },
    data: { isActive: false, closedAt: new Date(), closedByDiscordId },
  });
}

export async function countStudyGroupMembers(studyGroupId: string): Promise<number> {
  return prisma.studyGroupMember.count({ where: { studyGroupId } });
}

export async function listStudyGroupMembers(studyGroupId: string): Promise<StudyGroupMember[]> {
  return prisma.studyGroupMember.findMany({
    where: { studyGroupId },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function getStudyGroupMembership(
  studyGroupId: string,
  memberDiscordId: string,
): Promise<StudyGroupMember | null> {
  return prisma.studyGroupMember.findUnique({
    where: { studyGroupId_memberDiscordId: { studyGroupId, memberDiscordId } },
  });
}

export interface AddStudyGroupMemberInput {
  guildId: string;
  classId: string;
  studyGroupId: string;
  memberDiscordId: string;
}

/**
 * Fuegt ein Mitglied einer Lerngruppe hinzu. Eindeutig per DB-Constraint
 * (`@@unique([studyGroupId, memberDiscordId])`) - ein erneuter Beitrittsversuch
 * legt keinen zweiten Eintrag an, sondern liefert die bestehende Mitgliedschaft
 * zurueck (`created: false`).
 *
 * Der vorherige Check ist fuer sich genommen nicht atomar: bei zwei nahezu
 * gleichzeitigen Beitrittsversuchen (z. B. Doppelklick) koennten beide
 * `existing === null` sehen und beide `create()` versuchen. Die
 * Unique-Constraint verhindert dabei zuverlaessig eine doppelte
 * Mitgliedschaft, wuerde den zweiten (verlierenden) Versuch aber mit einem
 * Datenbankfehler abbrechen lassen - stattdessen wird dieser Fall abgefangen
 * und wie ein normaler "bereits Mitglied"-Treffer behandelt.
 */
export async function addStudyGroupMember(
  input: AddStudyGroupMemberInput,
): Promise<{ membership: StudyGroupMember; created: boolean }> {
  const existing = await getStudyGroupMembership(input.studyGroupId, input.memberDiscordId);
  if (existing) {
    return { membership: existing, created: false };
  }

  try {
    const membership = await prisma.studyGroupMember.create({ data: input });
    return { membership, created: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await getStudyGroupMembership(input.studyGroupId, input.memberDiscordId);
      if (raced) {
        return { membership: raced, created: false };
      }
    }
    throw error;
  }
}

export async function removeStudyGroupMember(
  studyGroupId: string,
  memberDiscordId: string,
): Promise<void> {
  await prisma.studyGroupMember.deleteMany({ where: { studyGroupId, memberDiscordId } });
}

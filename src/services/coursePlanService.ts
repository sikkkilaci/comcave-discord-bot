import type { CourseEntry, CourseSpecialDay, GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass, listMembersByClassId } from '../repositories/memberRepository.js';
import {
  acknowledgeCourseEntry,
  getAcknowledgment,
  getCourseEntryById,
  listAcknowledgmentsForCourseEntry,
  listCourseEntriesByClassId,
  listCourseSpecialDaysByClassId,
} from '../repositories/coursePlanRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { getIsoWeek, getIsoWeekYear, toDateOnlyUtc } from '../utils/dateTime.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

/** Liefert den zeitlich naechsten Kurs nach `today` aus einer Liste (bereits nach Start sortiert erwartet). */
function findNextEntry(entries: CourseEntry[], today: Date): CourseEntry | null {
  return (
    entries
      .filter((entry) => entry.startDate.getTime() > today.getTime())
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null
  );
}

function findCurrentEntry(entries: CourseEntry[], today: Date): CourseEntry | null {
  return (
    entries.find(
      (entry) =>
        today.getTime() >= entry.startDate.getTime() && today.getTime() <= entry.endDate.getTime(),
    ) ?? null
  );
}

function findCurrentSpecialDay(days: CourseSpecialDay[], today: Date): CourseSpecialDay | null {
  return (
    days.find(
      (day) =>
        today.getTime() >= day.startDate.getTime() && today.getTime() <= day.endDate.getTime(),
    ) ?? null
  );
}

export interface CoursePlanOverviewResult {
  className: ClassName;
  /** false = fuer diese Klasse liegen noch keine Kursplan-Daten vor (aktuell nur Klasse A). */
  hasOwnPlan: boolean;
  isoWeek: number;
  isoWeekYear: number;
  currentEntry: CourseEntry | null;
  currentEntryAcknowledgedAt: Date | null;
  nextEntry: CourseEntry | null;
  currentSpecialDay: CourseSpecialDay | null;
}

/**
 * Liefert die persoenliche Kursplan-Uebersicht (aktueller/naechster Kurs) fuer
 * ein Mitglied. Ohne explizite Klassenangabe wird die eigene Klasse verwendet
 * (`Member.classId`), Lesezugriff ausschliesslich ueber assertClassReadAccess()
 * - dieselbe zentrale Pruefung wie bei Pruefungen/Terminen/Lernmaterial, keine
 * zweite Berechtigungslogik. Eine Klasse ohne importierte Kurse (aktuell B/C)
 * liefert `hasOwnPlan: false` statt der Daten einer anderen Klasse.
 */
export async function getCoursePlanOverviewForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
  now: Date = new Date(),
): Promise<CoursePlanOverviewResult> {
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

  const today = toDateOnlyUtc(now);
  const isoWeek = getIsoWeek(today);
  const isoWeekYear = getIsoWeekYear(today);

  const entries = await listCourseEntriesByClassId(klasse.id);
  if (entries.length === 0) {
    return {
      className: targetName,
      hasOwnPlan: false,
      isoWeek,
      isoWeekYear,
      currentEntry: null,
      currentEntryAcknowledgedAt: null,
      nextEntry: null,
      currentSpecialDay: null,
    };
  }

  const currentEntry = findCurrentEntry(entries, today);
  const nextEntry = findNextEntry(entries, today);

  const currentEntryAcknowledgedAt = currentEntry
    ? ((await getAcknowledgment(currentEntry.id, member.id))?.acknowledgedAt ?? null)
    : null;

  const specialDays = await listCourseSpecialDaysByClassId(klasse.id);
  const currentSpecialDay = findCurrentSpecialDay(specialDays, today);

  return {
    className: targetName,
    hasOwnPlan: true,
    isoWeek,
    isoWeekYear,
    currentEntry,
    currentEntryAcknowledgedAt,
    nextEntry,
    currentSpecialDay,
  };
}

export interface CoursePlanStatusResult {
  className: ClassName;
  currentEntry: CourseEntry | null;
  nextEntry: CourseEntry | null;
  acknowledgedDiscordIds: string[];
  pendingDiscordIds: string[];
}

/**
 * Liefert aktuellen/naechsten Kurs sowie den Kenntnisnahme-Status (wer hat
 * bestaetigt, wer nicht) einer Klasse - ausschliesslich fuer Admin oder die
 * Klassenleitung genau dieser Klasse (assertClassManagementAccess()).
 * Klassenleitung B kann damit niemals den Status von Klasse A abfragen, auch
 * nicht ueber eine manipulierte `klasse`-Angabe.
 */
export async function getCoursePlanStatusForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  now: Date = new Date(),
): Promise<CoursePlanStatusResult> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new NotFoundError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const today = toDateOnlyUtc(now);
  const entries = await listCourseEntriesByClassId(klasse.id);
  const currentEntry = findCurrentEntry(entries, today);
  const nextEntry = findNextEntry(entries, today);

  let acknowledgedDiscordIds: string[] = [];
  let pendingDiscordIds: string[] = [];
  if (currentEntry) {
    const [acknowledgments, classMembers] = await Promise.all([
      listAcknowledgmentsForCourseEntry(currentEntry.id),
      listMembersByClassId(klasse.id),
    ]);
    const acknowledgedSet = new Set(acknowledgments.map((entry) => entry.memberDiscordId));
    acknowledgedDiscordIds = [...acknowledgedSet];
    pendingDiscordIds = classMembers
      .map((classMember) => classMember.discordId)
      .filter((discordId) => !acknowledgedSet.has(discordId));
  }

  return { className, currentEntry, nextEntry, acknowledgedDiscordIds, pendingDiscordIds };
}

export interface CoursePlanAcknowledgeResult {
  created: boolean;
  acknowledgedAt: Date;
  courseEntry: CourseEntry;
  className: ClassName;
}

/**
 * Bestaetigt Kenntnisnahme eines Kurs-Slots durch das aufrufende Mitglied
 * (Button "Kenntnis genommen"). Der Kurs wird immer per `guildConfig.id`
 * aufgeloest und die Berechtigung ueber dieselbe assertClassReadAccess()
 * geprueft wie bei der Anzeige - eine manipulierte Kurs-ID aus einer fremden
 * Klasse/Guild oder ein Klick durch ein unverifiziertes/fremdes Mitglied wird
 * dadurch fail-closed abgelehnt. Ein erneuter Klick erzeugt keine zweite
 * Kenntnisnahme (siehe acknowledgeCourseEntry() im Repository).
 */
export async function acknowledgeCourseEntryForMember(
  guildConfig: GuildConfig,
  member: GuildMember,
  courseEntryId: string,
): Promise<CoursePlanAcknowledgeResult> {
  const entry = await getCourseEntryById(guildConfig.id, courseEntryId);
  if (!entry) {
    throw new NotFoundError('Dieser Kurs wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, entry.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }

  const memberRow = await getMemberWithClass(guildConfig.id, member.id);
  assertClassReadAccess(member, guildConfig, klasse, memberRow?.classId ?? null);

  const { acknowledgment, created } = await acknowledgeCourseEntry({
    guildId: guildConfig.id,
    classId: klasse.id,
    courseEntryId: entry.id,
    memberDiscordId: member.id,
  });

  if (created) {
    await logAuditEvent({
      guildId: guildConfig.id,
      actorDiscordId: member.id,
      action: 'coursePlan.acknowledge',
      metadata: {
        courseEntryId: entry.id,
        courseNumber: entry.courseNumber,
        className: klasse.name,
      },
    });
  }

  return {
    created,
    acknowledgedAt: acknowledgment.acknowledgedAt,
    courseEntry: entry,
    className: klasse.name as ClassName,
  };
}

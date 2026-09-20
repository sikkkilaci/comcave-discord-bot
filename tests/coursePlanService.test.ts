import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getClassByName,
  updateClassLead,
  updateClassRole,
} from '../src/repositories/classRepository.js';
import { setMemberClass } from '../src/repositories/memberRepository.js';
import { upsertCourseEntry } from '../src/repositories/coursePlanRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  acknowledgeCourseEntryForMember,
  getCoursePlanOverviewForClass,
  getCoursePlanStatusForClass,
} from '../src/services/coursePlanService.js';
import { NotFoundError, PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: {
  id: string;
  ownerId?: string;
  isAdministrator?: boolean;
  roleIds?: string[];
}): GuildMember {
  const roleIds = new Set(options.roleIds ?? []);
  return {
    id: options.id,
    guild: { ownerId: options.ownerId ?? 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
  } as unknown as GuildMember;
}

/** Fester Referenzzeitpunkt fuer deterministische Tests, unabhaengig von der echten Systemzeit. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

async function setupGuildWithClassesAB() {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  await updateClassRole(guildId, 'A', `role-a-${randomUUID()}`);
  await updateClassRole(guildId, 'B', `role-b-${randomUUID()}`);
  const leadRoleA = `lead-a-${randomUUID()}`;
  const leadRoleB = `lead-b-${randomUUID()}`;
  await updateClassLead(guildId, 'A', { leadRoleId: leadRoleA });
  await updateClassLead(guildId, 'B', { leadRoleId: leadRoleB });
  const classA = (await getClassByName(guildId, 'A'))!;
  const classB = (await getClassByName(guildId, 'B'))!;
  return { guildId, guildConfig, classA, classB, leadRoleA, leadRoleB };
}

async function seedCourseA(
  guildId: string,
  classId: string,
): Promise<{ current: string; next: string; past: string }> {
  const past = await upsertCourseEntry({
    guildId,
    classId,
    courseNumber: 'C-PAST',
    title: 'Vergangener Kurs',
    trainer: 'Frau Alt',
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    endDate: new Date('2026-09-10T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
  });
  const current = await upsertCourseEntry({
    guildId,
    classId,
    courseNumber: 'C-CURRENT',
    title: 'Aktueller Kurs',
    trainer: 'Herr Jetzt',
    startDate: new Date('2026-09-15T00:00:00.000Z'),
    endDate: new Date('2026-09-25T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
  });
  const next = await upsertCourseEntry({
    guildId,
    classId,
    courseNumber: 'C-NEXT',
    title: 'Naechster Kurs',
    trainer: null,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-10T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
  });
  return { current: current.entry.id, next: next.entry.id, past: past.entry.id };
}

describe('getCoursePlanOverviewForClass', () => {
  it('zeigt den aktuellen und naechsten Kurs fuer ein Mitglied der eigenen Klasse', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const overview = await getCoursePlanOverviewForClass(guildConfig, member, null, NOW);

    expect(overview.hasOwnPlan).toBe(true);
    expect(overview.currentEntry?.title).toBe('Aktueller Kurs');
    expect(overview.nextEntry?.title).toBe('Naechster Kurs');
    expect(overview.isoWeek).toBe(38);
    expect(overview.isoWeekYear).toBe(2026);
  });

  it('zeigt "kein Kurs" an, wenn das aktuelle Datum in keinem Kurszeitraum liegt', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-FUTURE',
      title: 'Zukuenftiger Kurs',
      trainer: null,
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-10T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const overview = await getCoursePlanOverviewForClass(guildConfig, member, null, NOW);

    expect(overview.hasOwnPlan).toBe(true);
    expect(overview.currentEntry).toBeNull();
    expect(overview.nextEntry?.title).toBe('Zukuenftiger Kurs');
  });

  it('B/C ohne eigene Kursplan-Daten erhalten hasOwnPlan:false statt der Daten von Klasse A', async () => {
    const { guildId, guildConfig, classA, classB } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-b' });
    await setMemberClass(guildId, member.id, classB.id);

    const overview = await getCoursePlanOverviewForClass(guildConfig, member, null, NOW);

    expect(overview.className).toBe('B');
    expect(overview.hasOwnPlan).toBe(false);
    expect(overview.currentEntry).toBeNull();
    expect(overview.nextEntry).toBeNull();
  });

  it('verweigert einem Mitglied einer FREMDEN Klasse den Zugriff (Klassenisolierung)', async () => {
    const { guildId, guildConfig, classA, classB } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const memberOfB = fakeMember({ id: 'member-b' });
    await setMemberClass(guildId, memberOfB.id, classB.id);

    await expect(
      getCoursePlanOverviewForClass(guildConfig, memberOfB, 'A', NOW),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('lehnt fail-closed ab, wenn ein unverifiziertes Mitglied (keine Klasse) keine Klasse angibt', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const unverified = fakeMember({ id: 'unverified-1' });

    await expect(
      getCoursePlanOverviewForClass(guildConfig, unverified, null, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('verweigert einem unverifizierten Mitglied den Zugriff auf eine explizit angegebene Klasse', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const unverified = fakeMember({ id: 'unverified-1' });

    await expect(
      getCoursePlanOverviewForClass(guildConfig, unverified, 'A', NOW),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('Klassenleitung A sieht den Kursplan A auch ohne selbst Mitglied der Klasse zu sein', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    const overview = await getCoursePlanOverviewForClass(guildConfig, leadA, 'A', NOW);

    expect(overview.currentEntry?.title).toBe('Aktueller Kurs');
  });

  it('vermischt keine Guilds - eine zweite Guild hat einen unabhaengigen, leeren Kursplan', async () => {
    const { guildId: guildIdA, classA } = await setupGuildWithClassesAB();
    await seedCourseA(guildIdA, classA.id);

    const { guildConfig: guildConfigB, classA: classAOfGuildB } = await setupGuildWithClassesAB();
    const memberOfGuildB = fakeMember({ id: 'member-1' });
    await setMemberClass(guildConfigB.id, memberOfGuildB.id, classAOfGuildB.id);

    const overview = await getCoursePlanOverviewForClass(guildConfigB, memberOfGuildB, null, NOW);

    expect(overview.hasOwnPlan).toBe(false);
  });
});

describe('acknowledgeCourseEntryForMember', () => {
  it('speichert eine Kenntnisnahme mit Member, Klasse, Kurs und Zeitpunkt', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const result = await acknowledgeCourseEntryForMember(guildConfig, member, current);

    expect(result.created).toBe(true);
    expect(result.className).toBe('A');
    expect(result.courseEntry.id).toBe(current);
    expect(result.acknowledgedAt).toBeInstanceOf(Date);
  });

  it('ein erneuter Klick erzeugt keine zweite Kenntnisnahme (Duplicate Prevention)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const first = await acknowledgeCourseEntryForMember(guildConfig, member, current);
    const second = await acknowledgeCourseEntryForMember(guildConfig, member, current);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.acknowledgedAt.getTime()).toBe(first.acknowledgedAt.getTime());

    const status = await getCoursePlanStatusForClass(
      guildConfig,
      fakeMember({ id: 'admin-1', isAdministrator: true }),
      'A',
      NOW,
    );
    expect(status.acknowledgedDiscordIds).toEqual(['member-1']);
  });

  it('schreibt nur beim ERSTEN Klick einen Audit-Log-Eintrag', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await acknowledgeCourseEntryForMember(guildConfig, member, current);
    await acknowledgeCourseEntryForMember(guildConfig, member, current);

    const entries = await listAuditEvents(guildId);
    const ackEntries = entries.filter((e) => e.action === 'coursePlan.acknowledge');
    expect(ackEntries).toHaveLength(1);
  });

  it('verweigert die Kenntnisnahme fuer ein Mitglied einer FREMDEN Klasse', async () => {
    const { guildId, guildConfig, classA, classB } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const memberOfB = fakeMember({ id: 'member-b' });
    await setMemberClass(guildId, memberOfB.id, classB.id);

    await expect(
      acknowledgeCourseEntryForMember(guildConfig, memberOfB, current),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('verweigert die Kenntnisnahme fuer ein unverifiziertes Mitglied', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const unverified = fakeMember({ id: 'unverified-1' });

    await expect(
      acknowledgeCourseEntryForMember(guildConfig, unverified, current),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('lehnt eine manipulierte/unbekannte Kurs-ID mit NotFoundError ab', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await expect(
      acknowledgeCourseEntryForMember(guildConfig, admin, 'does-not-exist'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lehnt eine Kurs-ID aus einer FREMDEN Guild ab (Guild-Isolation)', async () => {
    const { guildId: guildIdA, classA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildIdA, classA.id);

    const { guildConfig: guildConfigB } = await setupGuildWithClassesAB();
    const adminOfB = fakeMember({ id: 'admin-b', isAdministrator: true });

    await expect(
      acknowledgeCourseEntryForMember(guildConfigB, adminOfB, current),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getCoursePlanStatusForClass', () => {
  it('Klassenleitung A sieht bestaetigte und ausstehende Kenntnisnahmen fuer Klasse A', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const { current } = await seedCourseA(guildId, classA.id);
    const memberDone = fakeMember({ id: 'member-done' });
    const memberPending = fakeMember({ id: 'member-pending' });
    await setMemberClass(guildId, memberDone.id, classA.id);
    await setMemberClass(guildId, memberPending.id, classA.id);
    await acknowledgeCourseEntryForMember(guildConfig, memberDone, current);

    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
    const status = await getCoursePlanStatusForClass(guildConfig, leadA, 'A', NOW);

    expect(status.currentEntry?.title).toBe('Aktueller Kurs');
    expect(status.nextEntry?.title).toBe('Naechster Kurs');
    expect(status.acknowledgedDiscordIds).toEqual(['member-done']);
    expect(status.pendingDiscordIds).toEqual(['member-pending']);
  });

  it('Admin darf den Status jeder Klasse einsehen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const status = await getCoursePlanStatusForClass(guildConfig, admin, 'A', NOW);

    expect(status.currentEntry?.title).toBe('Aktueller Kurs');
  });

  it('Klassenleitung B darf NICHT den Status von Klasse A verwalten/einsehen', async () => {
    const { guildId, guildConfig, classA, leadRoleB } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

    await expect(getCoursePlanStatusForClass(guildConfig, leadB, 'A', NOW)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('ein normales (nicht-Klassenleitungs-)Mitglied der Klasse A darf den Status NICHT einsehen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    await seedCourseA(guildId, classA.id);
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await expect(getCoursePlanStatusForClass(guildConfig, member, 'A', NOW)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});

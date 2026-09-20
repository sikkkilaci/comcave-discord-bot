import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getClassByName, updateClassRole } from '../src/repositories/classRepository.js';
import { upsertCourseEntry } from '../src/repositories/coursePlanRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  checkUpcomingCourseNotificationsForGuild,
  findAndRecordUpcomingCourseNotifications,
} from '../src/services/coursePlanNotificationService.js';

const NOW = new Date('2026-09-20T12:00:00.000Z');

async function setupGuildWithClassA() {
  const guildId = `guild-${randomUUID()}`;
  await getOrCreateGuildConfig(guildId);
  await updateClassRole(guildId, 'A', `role-a-${randomUUID()}`);
  const classA = (await getClassByName(guildId, 'A'))!;
  return { guildId, classA };
}

describe('findAndRecordUpcomingCourseNotifications', () => {
  it('erkennt einen Kurs, der innerhalb der naechsten 7 Tage beginnt', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-SOON',
      title: 'Bald startender Kurs',
      trainer: null,
      startDate: new Date('2026-09-25T00:00:00.000Z'), // in 5 Tagen
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const notified = await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);

    expect(notified).toHaveLength(1);
    expect(notified[0]?.courseNumber).toBe('C-SOON');
  });

  it('ignoriert einen Kurs, der erst in mehr als 7 Tagen beginnt', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-FAR',
      title: 'Weit entfernter Kurs',
      trainer: null,
      startDate: new Date('2026-10-15T00:00:00.000Z'),
      endDate: new Date('2026-10-20T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const notified = await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);

    expect(notified).toHaveLength(0);
  });

  it('ignoriert einen Kurs, der bereits begonnen hat', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-STARTED',
      title: 'Laufender Kurs',
      trainer: null,
      startDate: new Date('2026-09-15T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const notified = await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);

    expect(notified).toHaveLength(0);
  });

  it('erzeugt fuer denselben Kurs bei wiederholten Aufrufen keine doppelte Benachrichtigung', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-SOON',
      title: 'Bald startender Kurs',
      trainer: null,
      startDate: new Date('2026-09-25T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const first = await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);
    // Simuliert einen weiteren Bot-Start kurze Zeit spaeter.
    const second = await findAndRecordUpcomingCourseNotifications(
      guildId,
      classA.id,
      'A',
      new Date(NOW.getTime() + 60 * 60 * 1000),
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('schreibt genau einen "coursePlan.upcomingNotice"-Audit-Log-Eintrag pro neu erkanntem Kurs', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-SOON',
      title: 'Bald startender Kurs',
      trainer: null,
      startDate: new Date('2026-09-25T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);
    await findAndRecordUpcomingCourseNotifications(guildId, classA.id, 'A', NOW);

    const entries = await listAuditEvents(guildId);
    const noticeEntries = entries.filter((e) => e.action === 'coursePlan.upcomingNotice');
    expect(noticeEntries).toHaveLength(1);
  });
});

describe('checkUpcomingCourseNotificationsForGuild', () => {
  it('liefert nur Klassen mit tatsaechlich neu erkannten Kursen zurueck', async () => {
    const { guildId, classA } = await setupGuildWithClassA();
    await updateClassRole(guildId, 'B', `role-b-${randomUUID()}`);
    await upsertCourseEntry({
      guildId,
      classId: classA.id,
      courseNumber: 'C-SOON',
      title: 'Bald startender Kurs',
      trainer: null,
      startDate: new Date('2026-09-25T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const results = await checkUpcomingCourseNotificationsForGuild(guildId, NOW);

    expect(results).toHaveLength(1);
    expect(results[0]?.klasse.name).toBe('A');
    expect(results[0]?.entries).toHaveLength(1);
  });

  it('vermischt keine Guilds - Kurse einer anderen Guild loesen keine Benachrichtigung aus', async () => {
    const { guildId: guildIdA, classA } = await setupGuildWithClassA();
    await upsertCourseEntry({
      guildId: guildIdA,
      classId: classA.id,
      courseNumber: 'C-SOON',
      title: 'Bald startender Kurs',
      trainer: null,
      startDate: new Date('2026-09-25T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const { guildId: guildIdB } = await setupGuildWithClassA();

    const resultsForB = await checkUpcomingCourseNotificationsForGuild(guildIdB, NOW);

    expect(resultsForB).toHaveLength(0);
  });
});

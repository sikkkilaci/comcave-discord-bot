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
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  createWeeklyReportForClass,
  deleteWeeklyReportForClass,
  listWeeklyReportsForClass,
  updateWeeklyReportForClass,
} from '../src/services/weeklyReportService.js';
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

const VALID_INPUT = {
  kalenderwoche: 12,
  zeitraumStart: '16.03.2026',
  zeitraumEnde: '20.03.2026',
  themen: 'Datenbankmodellierung',
  lernfortschritt: 'Normalisierung verstanden',
  hinweise: 'Keine Besonderheiten',
};

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

describe('weeklyReportService', () => {
  describe('createWeeklyReportForClass - Berechtigung', () => {
    it('Admin kann einen Wochenbericht fuer jede Klasse anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      expect(report.calendarWeek).toBe(12);
      expect(report.year).toBe(2026);
    });

    it('Klassenleitung A kann einen Wochenbericht fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      const report = await createWeeklyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      expect(report.calendarWeek).toBe(12);
    });

    it('Klassenleitung A kann KEINEN Wochenbericht fuer Klasse B anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createWeeklyReportForClass(guildConfig, leadA, 'B', VALID_INPUT, leadA.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung B kann KEINEN Wochenbericht fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

      await expect(
        createWeeklyReportForClass(guildConfig, leadB, 'A', VALID_INPUT, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('ein normales Mitglied darf keinen Wochenbericht anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(
        createWeeklyReportForClass(guildConfig, member, 'A', VALID_INPUT, member.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('createWeeklyReportForClass - Kalenderwochen-/Datumsvalidierung', () => {
    it('lehnt eine Kalenderwoche kleiner als 1 ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createWeeklyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, kalenderwoche: 0 },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine Kalenderwoche groesser als 53 ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createWeeklyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, kalenderwoche: 54 },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine nicht-ganzzahlige Kalenderwoche ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createWeeklyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, kalenderwoche: 12.5 },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt ein ungueltiges Datumsformat im Zeitraum ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createWeeklyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, zeitraumStart: '2026-03-16' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt einen Zeitraum ab, dessen Ende vor dem Beginn liegt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createWeeklyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, zeitraumStart: '20.03.2026', zeitraumEnde: '16.03.2026' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('leitet das Jahr aus dem Zeitraum-Beginn ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        { ...VALID_INPUT, zeitraumStart: '29.12.2025', zeitraumEnde: '02.01.2026' },
        admin.id,
      );

      expect(report.year).toBe(2025);
    });
  });

  describe('createWeeklyReportForClass - Audit-Log', () => {
    it('schreibt einen "weeklyReport.create"-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'weeklyReport.create');
      expect(entry).toBeDefined();
      expect(JSON.parse(entry?.metadata ?? '{}').reportId).toBe(report.id);
    });
  });

  describe('updateWeeklyReportForClass / deleteWeeklyReportForClass - Manipulationsschutz', () => {
    it('verweigert Klassenleitung B das Bearbeiten eines Wochenberichts von Klasse A ueber die Berichts-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const report = await createWeeklyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        updateWeeklyReportForClass(
          guildConfig,
          leadB,
          report.id,
          { themen: 'Uebernahme' },
          leadB.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('verweigert Klassenleitung B das Loeschen eines Wochenberichts von Klasse A ueber die Berichts-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const report = await createWeeklyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        deleteWeeklyReportForClass(guildConfig, leadB, report.id, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung A kann einen eigenen Wochenbericht bearbeiten und loeschen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const report = await createWeeklyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      const updated = await updateWeeklyReportForClass(
        guildConfig,
        leadA,
        report.id,
        { kalenderwoche: 13 },
        leadA.id,
      );
      expect(updated.calendarWeek).toBe(13);

      const deleted = await deleteWeeklyReportForClass(guildConfig, leadA, report.id, leadA.id);
      expect(deleted.id).toBe(report.id);
    });

    it('wirft NotFoundError fuer eine unbekannte Berichts-ID', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        updateWeeklyReportForClass(guildConfig, admin, 'does-not-exist', { themen: 'X' }, admin.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateWeeklyReportForClass - Validierung und Audit-Log', () => {
    it('lehnt eine Aenderung ohne jedes Feld ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateWeeklyReportForClass(guildConfig, admin, report.id, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine Aenderung des Zeitraum-Starts ohne begleitendes Ende ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateWeeklyReportForClass(
          guildConfig,
          admin,
          report.id,
          { zeitraumStart: '01.01.2026' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('aktualisiert das Jahr, wenn der Zeitraum geaendert wird', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      const updated = await updateWeeklyReportForClass(
        guildConfig,
        admin,
        report.id,
        { zeitraumStart: '28.12.2027', zeitraumEnde: '01.01.2028' },
        admin.id,
      );

      expect(updated.year).toBe(2027);
    });

    it('schreibt einen "weeklyReport.update"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await updateWeeklyReportForClass(
        guildConfig,
        admin,
        report.id,
        { themen: 'Update' },
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'weeklyReport.update')).toBe(true);
    });
  });

  describe('deleteWeeklyReportForClass - Audit-Log', () => {
    it('schreibt einen "weeklyReport.delete"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createWeeklyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await deleteWeeklyReportForClass(guildConfig, admin, report.id, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'weeklyReport.delete')).toBe(true);
    });
  });

  describe('listWeeklyReportsForClass', () => {
    it('ein Mitglied kann die Wochenberichte der eigenen Klasse ohne Angabe lesen', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await createWeeklyReportForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      const { className, reports } = await listWeeklyReportsForClass(guildConfig, member, null);

      expect(className).toBe('A');
      expect(reports).toHaveLength(1);
    });

    it('verweigert einem Mitglied das Lesen einer fremden Klasse', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      await expect(listWeeklyReportsForClass(guildConfig, member, 'B')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('lehnt fail-closed ab, wenn das Mitglied keiner Klasse zugeordnet ist und keine Klasse angibt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(listWeeklyReportsForClass(guildConfig, member, null)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});

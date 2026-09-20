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
  createDailyReportForClass,
  deleteDailyReportForClass,
  listDailyReportsForClass,
  updateDailyReportForClass,
} from '../src/services/dailyReportService.js';
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
  datum: '15.09.2026',
  themen: 'Prisma-Migrationen',
  lerninhalte: 'Schema-Design und additive Migrationen',
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

describe('dailyReportService', () => {
  describe('createDailyReportForClass - Berechtigung', () => {
    it('Admin kann einen Tagesbericht fuer jede Klasse anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      expect(report.topics).toBe('Prisma-Migrationen');
    });

    it('Klassenleitung A kann einen Tagesbericht fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      const report = await createDailyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      expect(report.topics).toBe('Prisma-Migrationen');
    });

    it('Klassenleitung A kann KEINEN Tagesbericht fuer Klasse B anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createDailyReportForClass(guildConfig, leadA, 'B', VALID_INPUT, leadA.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung B kann KEINEN Tagesbericht fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

      await expect(
        createDailyReportForClass(guildConfig, leadB, 'A', VALID_INPUT, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('ein normales Mitglied darf keinen Tagesbericht anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(
        createDailyReportForClass(guildConfig, member, 'A', VALID_INPUT, member.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('createDailyReportForClass - Validierung', () => {
    it('lehnt leere Themen ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createDailyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, themen: '  ' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt ein ungueltiges Datumsformat ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createDailyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, datum: '2026-09-15' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt ein nicht existierendes Datum ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createDailyReportForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, datum: '31.04.2026' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('speichert optionale Lernmaterialien, wenn angegeben', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        { ...VALID_INPUT, lernmaterialien: 'Kapitel 4 PDF' },
        admin.id,
      );

      expect(report.relatedMaterials).toBe('Kapitel 4 PDF');
    });

    it('speichert null, wenn keine Lernmaterialien angegeben sind', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      expect(report.relatedMaterials).toBeNull();
    });
  });

  describe('createDailyReportForClass - Audit-Log', () => {
    it('schreibt einen "dailyReport.create"-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'dailyReport.create');
      expect(entry).toBeDefined();
      expect(JSON.parse(entry?.metadata ?? '{}').reportId).toBe(report.id);
    });
  });

  describe('updateDailyReportForClass / deleteDailyReportForClass - Manipulationsschutz', () => {
    it('verweigert Klassenleitung B das Bearbeiten eines Tagesberichts von Klasse A ueber die Berichts-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const report = await createDailyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        updateDailyReportForClass(
          guildConfig,
          leadB,
          report.id,
          { themen: 'Uebernahme' },
          leadB.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('verweigert Klassenleitung B das Loeschen eines Tagesberichts von Klasse A ueber die Berichts-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const report = await createDailyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        deleteDailyReportForClass(guildConfig, leadB, report.id, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung A kann einen eigenen Tagesbericht bearbeiten und loeschen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const report = await createDailyReportForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      const updated = await updateDailyReportForClass(
        guildConfig,
        leadA,
        report.id,
        { themen: 'Neue Themen' },
        leadA.id,
      );
      expect(updated.topics).toBe('Neue Themen');

      const deleted = await deleteDailyReportForClass(guildConfig, leadA, report.id, leadA.id);
      expect(deleted.id).toBe(report.id);
    });

    it('wirft NotFoundError fuer eine unbekannte Berichts-ID', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        updateDailyReportForClass(guildConfig, admin, 'does-not-exist', { themen: 'X' }, admin.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateDailyReportForClass - Validierung und Audit-Log', () => {
    it('lehnt eine Aenderung ohne jedes Feld ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateDailyReportForClass(guildConfig, admin, report.id, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('schreibt einen "dailyReport.update"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await updateDailyReportForClass(
        guildConfig,
        admin,
        report.id,
        { themen: 'Update' },
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'dailyReport.update')).toBe(true);
    });
  });

  describe('deleteDailyReportForClass - Audit-Log', () => {
    it('schreibt einen "dailyReport.delete"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const report = await createDailyReportForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await deleteDailyReportForClass(guildConfig, admin, report.id, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'dailyReport.delete')).toBe(true);
    });
  });

  describe('listDailyReportsForClass', () => {
    it('ein Mitglied kann die Tagesberichte der eigenen Klasse ohne Angabe lesen', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await createDailyReportForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      const { className, reports } = await listDailyReportsForClass(guildConfig, member, null);

      expect(className).toBe('A');
      expect(reports).toHaveLength(1);
    });

    it('verweigert einem Mitglied das Lesen einer fremden Klasse', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      await expect(listDailyReportsForClass(guildConfig, member, 'B')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('lehnt fail-closed ab, wenn das Mitglied keiner Klasse zugeordnet ist und keine Klasse angibt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(listDailyReportsForClass(guildConfig, member, null)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});

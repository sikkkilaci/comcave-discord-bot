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
  createExamForClass,
  deleteExamForClass,
  listExamsForClass,
  updateExamForClass,
} from '../src/services/examService.js';
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
  fach: 'Mathematik',
  beschreibung: 'Abschlusspruefung',
  datum: '24.12.2026',
  uhrzeit: '10:00',
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

describe('examService', () => {
  describe('createExamForClass - Berechtigung', () => {
    it('Admin kann eine Pruefung fuer jede Klasse anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      expect(exam.subject).toBe('Mathematik');
    });

    it('Klassenleitung A kann eine Pruefung fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      const exam = await createExamForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      expect(exam.subject).toBe('Mathematik');
    });

    it('Klassenleitung A kann KEINE Pruefung fuer Klasse B anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createExamForClass(guildConfig, leadA, 'B', VALID_INPUT, leadA.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung B kann KEINE Pruefung fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

      await expect(
        createExamForClass(guildConfig, leadB, 'A', VALID_INPUT, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('ein normales Mitglied darf keine Pruefung anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(
        createExamForClass(guildConfig, member, 'A', VALID_INPUT, member.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('createExamForClass - Validierung', () => {
    it('lehnt ein leeres Fach/Thema ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createExamForClass(guildConfig, admin, 'A', { ...VALID_INPUT, fach: '   ' }, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt ein ungueltiges Datumsformat ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createExamForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, datum: '2026-12-24' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('speichert optionale Lernhinweise, wenn angegeben', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const exam = await createExamForClass(
        guildConfig,
        admin,
        'A',
        { ...VALID_INPUT, lernhinweise: 'Kapitel 1-3' },
        admin.id,
      );

      expect(exam.studyNotes).toBe('Kapitel 1-3');
    });
  });

  describe('createExamForClass - Audit-Log', () => {
    it('schreibt einen "exam.create"-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'exam.create');
      expect(entry).toBeDefined();
      expect(entry?.actorDiscordId).toBe(admin.id);
      expect(JSON.parse(entry?.metadata ?? '{}').examId).toBe(exam.id);
    });
  });

  describe('updateExamForClass / deleteExamForClass - Manipulationsschutz', () => {
    it('verweigert Klassenleitung B das Bearbeiten einer Pruefung von Klasse A ueber die Pruefungs-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const exam = await createExamForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      await expect(
        updateExamForClass(guildConfig, leadB, exam.id, { fach: 'Physik' }, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('verweigert Klassenleitung B das Loeschen einer Pruefung von Klasse A ueber die Pruefungs-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const exam = await createExamForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      await expect(
        deleteExamForClass(guildConfig, leadB, exam.id, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung A kann eine eigene Pruefung bearbeiten und loeschen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const exam = await createExamForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      const updated = await updateExamForClass(
        guildConfig,
        leadA,
        exam.id,
        { fach: 'Physik' },
        leadA.id,
      );
      expect(updated.subject).toBe('Physik');

      const deleted = await deleteExamForClass(guildConfig, leadA, exam.id, leadA.id);
      expect(deleted.id).toBe(exam.id);
    });

    it('wirft NotFoundError fuer eine unbekannte Pruefungs-ID', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        updateExamForClass(guildConfig, admin, 'does-not-exist', { fach: 'X' }, admin.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateExamForClass - Validierung', () => {
    it('lehnt eine Aenderung ohne jedes Feld ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      await expect(
        updateExamForClass(guildConfig, admin, exam.id, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine Datumsaenderung ohne begleitende Uhrzeit ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      await expect(
        updateExamForClass(guildConfig, admin, exam.id, { datum: '01.01.2027' }, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('schreibt einen "exam.update"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      await updateExamForClass(guildConfig, admin, exam.id, { fach: 'Physik' }, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'exam.update')).toBe(true);
    });
  });

  describe('deleteExamForClass - Audit-Log', () => {
    it('schreibt einen "exam.delete"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const exam = await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      await deleteExamForClass(guildConfig, admin, exam.id, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'exam.delete')).toBe(true);
    });
  });

  describe('listExamsForClass', () => {
    it('ein Mitglied kann die Pruefungen der eigenen Klasse ohne Angabe lesen', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await createExamForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      const { className, exams } = await listExamsForClass(guildConfig, member, null);

      expect(className).toBe('A');
      expect(exams).toHaveLength(1);
    });

    it('verweigert einem Mitglied das Lesen einer fremden Klasse', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      await expect(listExamsForClass(guildConfig, member, 'B')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('lehnt fail-closed ab, wenn das Mitglied keiner Klasse zugeordnet ist und keine Klasse angibt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(listExamsForClass(guildConfig, member, null)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('Klassenleitung kann die Pruefungen der eigenen Klasse lesen, auch ohne selbst Mitglied zu sein', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      await createExamForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      const { exams } = await listExamsForClass(guildConfig, leadA, 'A');

      expect(exams).toHaveLength(1);
    });
  });
});

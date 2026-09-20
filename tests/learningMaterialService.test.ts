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
import { createExamForClass } from '../src/services/examService.js';
import {
  createLearningMaterialForClass,
  deleteLearningMaterialForClass,
  listLearningMaterialsForClass,
  updateLearningMaterialForClass,
} from '../src/services/learningMaterialService.js';
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
  titel: 'Grundlagen Netzwerktechnik',
  beschreibung: 'Einfuehrung in OSI-Modell und TCP/IP',
  fach: 'Netzwerktechnik',
  kategorie: 'NETZWERKE',
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

describe('learningMaterialService', () => {
  describe('createLearningMaterialForClass - Berechtigung', () => {
    it('Admin kann Lernmaterial fuer jede Klasse anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      expect(material.title).toBe('Grundlagen Netzwerktechnik');
    });

    it('Klassenleitung A kann Lernmaterial fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      const material = await createLearningMaterialForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      expect(material.title).toBe('Grundlagen Netzwerktechnik');
    });

    it('Klassenleitung A kann KEIN Lernmaterial fuer Klasse B anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createLearningMaterialForClass(guildConfig, leadA, 'B', VALID_INPUT, leadA.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung B kann KEIN Lernmaterial fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

      await expect(
        createLearningMaterialForClass(guildConfig, leadB, 'A', VALID_INPUT, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('ein normales Mitglied darf kein Lernmaterial anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(
        createLearningMaterialForClass(guildConfig, member, 'A', VALID_INPUT, member.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('createLearningMaterialForClass - Validierung', () => {
    it('lehnt einen leeren Titel ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createLearningMaterialForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, titel: '  ' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine ungueltige Kategorie ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createLearningMaterialForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, kategorie: 'UNBEKANNT' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('speichert eine optionale URL, wenn angegeben', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        { ...VALID_INPUT, url: 'https://example.com/skript.pdf' },
        admin.id,
      );

      expect(material.url).toBe('https://example.com/skript.pdf');
    });

    it('speichert optionale Anhang-Metadaten, wenn angegeben', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        {
          ...VALID_INPUT,
          anhang: {
            url: 'https://cdn.discord/x.pdf',
            name: 'skript.pdf',
            contentType: 'application/pdf',
          },
        },
        admin.id,
      );

      expect(material.attachmentUrl).toBe('https://cdn.discord/x.pdf');
      expect(material.attachmentName).toBe('skript.pdf');
      expect(material.attachmentContentType).toBe('application/pdf');
    });
  });

  describe('createLearningMaterialForClass - Verknuepfung', () => {
    it('verknuepft erfolgreich mit einer Pruefung derselben Klasse', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const exam = await createExamForClass(
        guildConfig,
        leadA,
        'A',
        { fach: 'Mathe', beschreibung: 'Test', datum: '01.01.2027', uhrzeit: '10:00' },
        leadA.id,
      );

      const material = await createLearningMaterialForClass(
        guildConfig,
        leadA,
        'A',
        { ...VALID_INPUT, verknuepfungTyp: 'EXAM', verknuepfungId: exam.id },
        leadA.id,
      );

      expect(material.linkedType).toBe('EXAM');
      expect(material.linkedId).toBe(exam.id);
    });

    it('lehnt eine Verknuepfung mit einer Pruefung einer FREMDEN Klasse ab (manipulierte Verknuepfungs-ID)', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const examOfB = await createExamForClass(
        guildConfig,
        leadB,
        'B',
        { fach: 'Mathe', beschreibung: 'Test', datum: '01.01.2027', uhrzeit: '10:00' },
        leadB.id,
      );

      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createLearningMaterialForClass(
          guildConfig,
          leadA,
          'A',
          { ...VALID_INPUT, verknuepfungTyp: 'EXAM', verknuepfungId: examOfB.id },
          leadA.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt Verknuepfungstyp ohne Verknuepfungs-ID ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createLearningMaterialForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, verknuepfungTyp: 'EXAM' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('createLearningMaterialForClass - Audit-Log', () => {
    it('schreibt einen "learningMaterial.create"-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'learningMaterial.create');
      expect(entry).toBeDefined();
      expect(JSON.parse(entry?.metadata ?? '{}').materialId).toBe(material.id);
    });
  });

  describe('updateLearningMaterialForClass / deleteLearningMaterialForClass - Manipulationsschutz', () => {
    it('verweigert Klassenleitung B das Bearbeiten von Material aus Klasse A ueber die Material-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const material = await createLearningMaterialForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        updateLearningMaterialForClass(
          guildConfig,
          leadB,
          material.id,
          { titel: 'Uebernahme' },
          leadB.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('verweigert Klassenleitung B das Loeschen von Material aus Klasse A ueber die Material-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const material = await createLearningMaterialForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        deleteLearningMaterialForClass(guildConfig, leadB, material.id, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung A kann eigenes Material bearbeiten und loeschen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const material = await createLearningMaterialForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      const updated = await updateLearningMaterialForClass(
        guildConfig,
        leadA,
        material.id,
        { titel: 'Neuer Titel' },
        leadA.id,
      );
      expect(updated.title).toBe('Neuer Titel');

      const deleted = await deleteLearningMaterialForClass(
        guildConfig,
        leadA,
        material.id,
        leadA.id,
      );
      expect(deleted.id).toBe(material.id);
    });

    it('wirft NotFoundError fuer eine unbekannte Material-ID', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        updateLearningMaterialForClass(
          guildConfig,
          admin,
          'does-not-exist',
          { titel: 'X' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateLearningMaterialForClass - Validierung und Audit-Log', () => {
    it('lehnt eine Aenderung ohne jedes Feld ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateLearningMaterialForClass(guildConfig, admin, material.id, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine ungueltige neue Kategorie ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateLearningMaterialForClass(
          guildConfig,
          admin,
          material.id,
          { kategorie: 'UNBEKANNT' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('schreibt einen "learningMaterial.update"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await updateLearningMaterialForClass(
        guildConfig,
        admin,
        material.id,
        { titel: 'Update' },
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'learningMaterial.update')).toBe(true);
    });
  });

  describe('deleteLearningMaterialForClass - Audit-Log', () => {
    it('schreibt einen "learningMaterial.delete"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const material = await createLearningMaterialForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await deleteLearningMaterialForClass(guildConfig, admin, material.id, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'learningMaterial.delete')).toBe(true);
    });
  });

  describe('listLearningMaterialsForClass', () => {
    it('ein Mitglied kann das Lernmaterial der eigenen Klasse ohne Angabe lesen', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await createLearningMaterialForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      const { className, materials } = await listLearningMaterialsForClass(
        guildConfig,
        member,
        null,
      );

      expect(className).toBe('A');
      expect(materials).toHaveLength(1);
    });

    it('verweigert einem Mitglied das Lesen einer fremden Klasse', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      await expect(listLearningMaterialsForClass(guildConfig, member, 'B')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('lehnt fail-closed ab, wenn das Mitglied keiner Klasse zugeordnet ist und keine Klasse angibt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(listLearningMaterialsForClass(guildConfig, member, null)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('Klassenleitung kann das Lernmaterial der eigenen Klasse lesen, auch ohne selbst Mitglied zu sein', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      await createLearningMaterialForClass(guildConfig, leadA, 'A', VALID_INPUT, leadA.id);

      const { materials } = await listLearningMaterialsForClass(guildConfig, leadA, 'A');

      expect(materials).toHaveLength(1);
    });
  });
});

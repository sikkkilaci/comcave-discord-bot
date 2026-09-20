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
  createAppointmentForClass,
  deleteAppointmentForClass,
  listAppointmentsForClass,
  updateAppointmentForClass,
} from '../src/services/appointmentService.js';
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
  titel: 'Ausflug ins Museum',
  beschreibung: 'Treffpunkt am Haupteingang',
  datum: '15.03.2027',
  uhrzeit: '09:00',
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

describe('appointmentService', () => {
  describe('createAppointmentForClass - Berechtigung', () => {
    it('Admin kann einen Termin fuer jede Klasse anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      expect(appointment.title).toBe('Ausflug ins Museum');
    });

    it('Klassenleitung A kann einen Termin fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      const appointment = await createAppointmentForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      expect(appointment.title).toBe('Ausflug ins Museum');
    });

    it('Klassenleitung A kann KEINEN Termin fuer Klasse B anlegen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

      await expect(
        createAppointmentForClass(guildConfig, leadA, 'B', VALID_INPUT, leadA.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung B kann KEINEN Termin fuer Klasse A anlegen', async () => {
      const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

      await expect(
        createAppointmentForClass(guildConfig, leadB, 'A', VALID_INPUT, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('ein normales Mitglied darf keinen Termin anlegen', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(
        createAppointmentForClass(guildConfig, member, 'A', VALID_INPUT, member.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('createAppointmentForClass - Validierung', () => {
    it('lehnt einen leeren Titel ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createAppointmentForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, titel: '  ' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt ein ungueltiges Datumsformat ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        createAppointmentForClass(
          guildConfig,
          admin,
          'A',
          { ...VALID_INPUT, datum: 'morgen' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('createAppointmentForClass - Audit-Log', () => {
    it('schreibt einen "appointment.create"-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'appointment.create');
      expect(entry).toBeDefined();
      expect(JSON.parse(entry?.metadata ?? '{}').appointmentId).toBe(appointment.id);
    });
  });

  describe('updateAppointmentForClass / deleteAppointmentForClass - Manipulationsschutz', () => {
    it('verweigert Klassenleitung B das Bearbeiten eines Termins von Klasse A ueber die Termin-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const appointment = await createAppointmentForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        updateAppointmentForClass(
          guildConfig,
          leadB,
          appointment.id,
          { titel: 'Uebernahme' },
          leadB.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('verweigert Klassenleitung B das Loeschen eines Termins von Klasse A ueber die Termin-ID', async () => {
      const { guildConfig, leadRoleA, leadRoleB } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });
      const appointment = await createAppointmentForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      await expect(
        deleteAppointmentForClass(guildConfig, leadB, appointment.id, leadB.id),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('Klassenleitung A kann einen eigenen Termin bearbeiten und loeschen', async () => {
      const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
      const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });
      const appointment = await createAppointmentForClass(
        guildConfig,
        leadA,
        'A',
        VALID_INPUT,
        leadA.id,
      );

      const updated = await updateAppointmentForClass(
        guildConfig,
        leadA,
        appointment.id,
        { titel: 'Neuer Titel' },
        leadA.id,
      );
      expect(updated.title).toBe('Neuer Titel');

      const deleted = await deleteAppointmentForClass(guildConfig, leadA, appointment.id, leadA.id);
      expect(deleted.id).toBe(appointment.id);
    });

    it('wirft NotFoundError fuer eine unbekannte Termin-ID', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(
        updateAppointmentForClass(guildConfig, admin, 'does-not-exist', { titel: 'X' }, admin.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateAppointmentForClass - Validierung', () => {
    it('lehnt eine Aenderung ohne jedes Feld ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateAppointmentForClass(guildConfig, admin, appointment.id, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lehnt eine Uhrzeitaenderung ohne begleitendes Datum ab', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await expect(
        updateAppointmentForClass(
          guildConfig,
          admin,
          appointment.id,
          { uhrzeit: '11:00' },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('schreibt einen "appointment.update"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await updateAppointmentForClass(
        guildConfig,
        admin,
        appointment.id,
        { titel: 'Update' },
        admin.id,
      );

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'appointment.update')).toBe(true);
    });
  });

  describe('deleteAppointmentForClass - Audit-Log', () => {
    it('schreibt einen "appointment.delete"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      const appointment = await createAppointmentForClass(
        guildConfig,
        admin,
        'A',
        VALID_INPUT,
        admin.id,
      );

      await deleteAppointmentForClass(guildConfig, admin, appointment.id, admin.id);

      const entries = await listAuditEvents(guildId);
      expect(entries.some((e) => e.action === 'appointment.delete')).toBe(true);
    });
  });

  describe('listAppointmentsForClass', () => {
    it('ein Mitglied kann die Termine der eigenen Klasse ohne Angabe lesen', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await createAppointmentForClass(guildConfig, admin, 'A', VALID_INPUT, admin.id);

      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      const { className, appointments } = await listAppointmentsForClass(guildConfig, member, null);

      expect(className).toBe('A');
      expect(appointments).toHaveLength(1);
    });

    it('verweigert einem Mitglied das Lesen einer fremden Klasse', async () => {
      const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });
      await setMemberClass(guildId, member.id, classA.id);

      await expect(listAppointmentsForClass(guildConfig, member, 'B')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('lehnt fail-closed ab, wenn das Mitglied keiner Klasse zugeordnet ist und keine Klasse angibt', async () => {
      const { guildConfig } = await setupGuildWithClassesAB();
      const member = fakeMember({ id: 'member-1' });

      await expect(listAppointmentsForClass(guildConfig, member, null)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});

import { randomUUID } from 'node:crypto';
import { DiscordAPIError, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getClassByName, updateClassRole } from '../src/repositories/classRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { assignClassLead, removeClassLead } from '../src/services/classLeadService.js';
import { ValidationError } from '../src/utils/errors.js';

interface FakeRole {
  id: string;
  name: string;
  permissions: { has: (bit: bigint) => boolean };
}

interface FakeRoleCreateOptions {
  name: string;
  permissions: unknown[];
  mentionable?: boolean;
  hoist?: boolean;
}

function fakeGuildMember(discordId: string, initialRoleIds: string[] = []): GuildMember {
  const roleIds = new Set(initialRoleIds);
  return {
    id: discordId,
    roles: {
      cache: { has: (roleId: string) => roleIds.has(roleId) },
      add: vi.fn(async (roleId: string) => {
        roleIds.add(roleId);
      }),
      remove: vi.fn(async (roleId: string) => {
        roleIds.delete(roleId);
      }),
    },
  } as unknown as GuildMember;
}

function fakeGuild(options: {
  roles?: Map<string, FakeRole>;
  members?: Map<string, GuildMember>;
  createRoleImpl?: (opts: FakeRoleCreateOptions) => Promise<FakeRole>;
}): { guild: Guild; createCalls: FakeRoleCreateOptions[]; roles: Map<string, FakeRole> } {
  const roles = options.roles ?? new Map<string, FakeRole>();
  const members = options.members ?? new Map<string, GuildMember>();
  const createCalls: FakeRoleCreateOptions[] = [];

  const create = vi.fn(async (opts: FakeRoleCreateOptions) => {
    createCalls.push(opts);
    if (options.createRoleImpl) return options.createRoleImpl(opts);
    const role: FakeRole = {
      id: `role:${opts.name}`,
      name: opts.name,
      permissions: { has: () => false },
    };
    roles.set(role.id, role);
    return role;
  });

  const fetchRole = vi.fn(async (id: string) => {
    const role = roles.get(id);
    if (!role) throw new Error('Unknown Role');
    return role;
  });

  const fetchMember = vi.fn(async (id: string) => {
    const member = members.get(id);
    if (!member) throw new Error('Unknown Member');
    return member;
  });

  const guild = {
    id: 'guild-fake',
    roles: { create, fetch: fetchRole },
    members: { fetch: fetchMember },
  } as unknown as Guild;

  return { guild, createCalls, roles };
}

async function setupGuildAndClassA() {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  const roleId = `role-a-${randomUUID()}`;
  await updateClassRole(guildId, 'A', roleId);
  await updateClassRole(guildId, 'B', `role-b-${randomUUID()}`);
  return { guildId, guildConfig };
}

describe('classLeadService', () => {
  describe('assignClassLead - Validierung', () => {
    it('wirft ValidationError, wenn die Klasse noch keine Rolle hat', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const { guild } = fakeGuild({});
      const target = fakeGuildMember('member-1');

      await expect(
        assignClassLead(guild, guildConfig, 'A', target, 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('assignClassLead - Rollen-Erstanlage', () => {
    it('legt eine neue Klassenleitungs-Rolle ohne Basis-Berechtigungen an und weist sie zu', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const { guild, createCalls } = fakeGuild({});
      const target = fakeGuildMember('member-1');

      const result = await assignClassLead(guild, guildConfig, 'A', target, 'actor-1');

      expect(result.leadRoleCreated).toBe(true);
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.name).toBe('Klassenleitung A');
      expect(createCalls[0]?.permissions).toEqual([]);
      expect(target.roles.add).toHaveBeenCalledWith('role:Klassenleitung A', expect.any(String));

      const stored = await getClassByName(guildId, 'A');
      expect(stored?.leadRoleId).toBe('role:Klassenleitung A');
      expect(stored?.leadDiscordId).toBe('member-1');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'member-1' });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe('class.lead_assign');
      expect(auditEntries[0]?.actorDiscordId).toBe('actor-1');
    });

    it('verwendet eine bestehende Klassenleitungs-Rolle wieder, statt sie neu anzulegen', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const existingRole: FakeRole = {
        id: 'role-lead-existing',
        name: 'Klassenleitung A',
        permissions: { has: () => false },
      };
      const roles = new Map([[existingRole.id, existingRole]]);
      await updateClassRole(guildId, 'A', (await getClassByName(guildId, 'A'))!.roleId!);
      const { prisma } = await import('../src/db/client.js');
      await prisma.class.update({
        where: { guildId_name: { guildId, name: 'A' } },
        data: { leadRoleId: existingRole.id },
      });

      const { guild, createCalls } = fakeGuild({ roles });
      const target = fakeGuildMember('member-1');

      const result = await assignClassLead(guild, guildConfig, 'A', target, 'actor-1');

      expect(result.leadRoleCreated).toBe(false);
      expect(createCalls).toHaveLength(0);
      expect(target.roles.add).toHaveBeenCalledWith(existingRole.id, expect.any(String));
    });

    it('repariert eine in Discord geloeschte Klassenleitungs-Rolle (Selbstheilung)', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const { prisma } = await import('../src/db/client.js');
      await prisma.class.update({
        where: { guildId_name: { guildId, name: 'A' } },
        data: { leadRoleId: 'role-deleted' },
      });

      const { guild, createCalls } = fakeGuild({});
      const target = fakeGuildMember('member-1');

      const result = await assignClassLead(guild, guildConfig, 'A', target, 'actor-1');

      expect(result.leadRoleCreated).toBe(true);
      expect(createCalls).toHaveLength(1);
      const stored = await getClassByName(guildId, 'A');
      expect(stored?.leadRoleId).not.toBe('role-deleted');
    });
  });

  describe('assignClassLead - Sicherheitscheck Administrator-Rechte', () => {
    it('verweigert die Zuweisung, wenn die bestehende Klassenleitungs-Rolle Administrator-Rechte traegt', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const adminRole: FakeRole = {
        id: 'role-lead-admin',
        name: 'Klassenleitung A',
        permissions: { has: (bit: bigint) => bit === PermissionFlagsBits.Administrator },
      };
      const roles = new Map([[adminRole.id, adminRole]]);
      const { prisma } = await import('../src/db/client.js');
      await prisma.class.update({
        where: { guildId_name: { guildId, name: 'A' } },
        data: { leadRoleId: adminRole.id },
      });

      const { guild } = fakeGuild({ roles });
      const target = fakeGuildMember('member-1');

      await expect(
        assignClassLead(guild, guildConfig, 'A', target, 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('assignClassLead - Neuzuweisung / Wechsel', () => {
    it('entfernt bei Neuzuweisung derselben Klasse der alten Klassenleitung die Rolle', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const memberOld = fakeGuildMember('member-old');
      const memberNew = fakeGuildMember('member-new');
      const members = new Map([
        ['member-old', memberOld],
        ['member-new', memberNew],
      ]);
      const { guild } = fakeGuild({ members });

      await assignClassLead(guild, guildConfig, 'A', memberOld, 'actor-1');
      const result = await assignClassLead(guild, guildConfig, 'A', memberNew, 'actor-1');

      expect(memberOld.roles.remove).toHaveBeenCalledWith(
        'role:Klassenleitung A',
        expect.any(String),
      );
      expect(memberNew.roles.add).toHaveBeenCalledWith('role:Klassenleitung A', expect.any(String));
      expect(result.previousLeadDiscordId).toBe('member-old');

      const stored = await getClassByName(guildId, 'A');
      expect(stored?.leadDiscordId).toBe('member-new');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'member-new' });
      const changeEntry = auditEntries.find((e) => e.action === 'class.lead_change');
      expect(changeEntry).toBeDefined();
      expect(JSON.parse(changeEntry?.metadata ?? '{}').previousLeadDiscordId).toBe('member-old');
    });

    it('entfernt die Klassenleitung der alten Klasse, wenn dieselbe Person eine andere Klasse uebernimmt', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const member = fakeGuildMember('member-1');
      const members = new Map([['member-1', member]]);
      const { guild } = fakeGuild({ members });

      await assignClassLead(guild, guildConfig, 'A', member, 'actor-1');
      const result = await assignClassLead(guild, guildConfig, 'B', member, 'actor-1');

      expect(member.roles.remove).toHaveBeenCalledWith('role:Klassenleitung A', expect.any(String));
      expect(member.roles.add).toHaveBeenCalledWith('role:Klassenleitung B', expect.any(String));
      expect(result.reassignedFromClassName).toBe('A');

      const classA = await getClassByName(guildId, 'A');
      const classB = await getClassByName(guildId, 'B');
      expect(classA?.leadDiscordId).toBeNull();
      expect(classB?.leadDiscordId).toBe('member-1');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'member-1' });
      const changeEntry = auditEntries.find((e) => e.action === 'class.lead_change');
      expect(JSON.parse(changeEntry?.metadata ?? '{}').reassignedFromClassName).toBe('A');
    });

    it('ist idempotent: erneute Zuweisung derselben Person an dieselbe Klasse aendert die Rolle nicht erneut', async () => {
      const { guildConfig } = await setupGuildAndClassA();
      const member = fakeGuildMember('member-1');
      const { guild } = fakeGuild({});

      await assignClassLead(guild, guildConfig, 'A', member, 'actor-1');
      await assignClassLead(guild, guildConfig, 'A', member, 'actor-1');

      expect(member.roles.add).toHaveBeenCalledTimes(1);
      expect(member.roles.remove).not.toHaveBeenCalled();
    });
  });

  describe('removeClassLead', () => {
    it('entfernt eine zugewiesene Klassenleitung: Rolle wird entzogen, DB bereinigt, Audit-Log geschrieben', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const member = fakeGuildMember('member-1');
      const members = new Map([['member-1', member]]);
      const { guild } = fakeGuild({ members });
      await assignClassLead(guild, guildConfig, 'A', member, 'actor-1');

      const result = await removeClassLead(guild, guildConfig, 'A', 'actor-2');

      expect(result.changed).toBe(true);
      expect(result.removedDiscordId).toBe('member-1');
      expect(member.roles.remove).toHaveBeenCalledWith('role:Klassenleitung A', expect.any(String));

      const stored = await getClassByName(guildId, 'A');
      expect(stored?.leadDiscordId).toBeNull();
      expect(stored?.leadRoleId).toBe('role:Klassenleitung A');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'member-1' });
      const removeEntry = auditEntries.find((e) => e.action === 'class.lead_remove');
      expect(removeEntry).toBeDefined();
      expect(removeEntry?.actorDiscordId).toBe('actor-2');
    });

    it('gibt changed:false zurueck und schreibt keinen Audit-Log-Eintrag, wenn keine Klassenleitung zugewiesen ist', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const { guild } = fakeGuild({});

      const result = await removeClassLead(guild, guildConfig, 'A', 'actor-1');

      expect(result.changed).toBe(false);
      expect(result.removedDiscordId).toBeNull();

      const auditEntries = await listAuditEvents(guildId);
      expect(auditEntries.filter((e) => e.action === 'class.lead_remove')).toHaveLength(0);
    });

    it('wirft ValidationError fuer eine nicht konfigurierte Klasse', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const { guild } = fakeGuild({});

      await expect(removeClassLead(guild, guildConfig, 'A', 'actor-1')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('bereinigt die DB auch, wenn die Person nicht mehr auf dem Server gefunden werden kann', async () => {
      const { guildId, guildConfig } = await setupGuildAndClassA();
      const member = fakeGuildMember('member-1');
      const members = new Map([['member-1', member]]);
      const { guild } = fakeGuild({ members });
      await assignClassLead(guild, guildConfig, 'A', member, 'actor-1');

      // Person hat den Server inzwischen verlassen.
      members.delete('member-1');

      const result = await removeClassLead(guild, guildConfig, 'A', 'actor-2');

      expect(result.changed).toBe(true);
      const stored = await getClassByName(guildId, 'A');
      expect(stored?.leadDiscordId).toBeNull();
    });
  });

  describe('assignClassLead - Discord-Fehlerbehandlung', () => {
    it('uebersetzt fehlende Bot-Berechtigungen (Discord-Fehlercode 50013) beim Rollen-Erstellen in eine ValidationError', async () => {
      const { guildConfig } = await setupGuildAndClassA();
      const { guild } = fakeGuild({
        createRoleImpl: async () => {
          throw new DiscordAPIError(
            { code: 50013, message: 'Missing Permissions' },
            50013,
            403,
            'POST',
            '/guilds/x/roles',
            { body: undefined, files: undefined },
          );
        },
      });
      const target = fakeGuildMember('member-1');

      await expect(
        assignClassLead(guild, guildConfig, 'A', target, 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('reicht unbekannte Fehler beim Rollen-Erstellen unveraendert weiter', async () => {
      const { guildConfig } = await setupGuildAndClassA();
      const { guild } = fakeGuild({
        createRoleImpl: async () => {
          throw new Error('Netzwerkfehler');
        },
      });
      const target = fakeGuildMember('member-1');

      await expect(assignClassLead(guild, guildConfig, 'A', target, 'actor-1')).rejects.toThrow(
        'Netzwerkfehler',
      );
    });
  });
});

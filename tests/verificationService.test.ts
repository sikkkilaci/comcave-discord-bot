import { randomUUID } from 'node:crypto';
import { DiscordAPIError, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@prisma/client';
import {
  getOrCreateGuildConfig,
  updateGuildConfig,
} from '../src/repositories/guildConfigRepository.js';
import { getMember } from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { ensureMemberTracked, setMemberVerification } from '../src/services/verificationService.js';
import { ValidationError } from '../src/utils/errors.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

function fakeGuildMember(
  discordId: string,
  initialRoleIds: string[] = [],
  options: { addImpl?: (roleId: string, reason?: string) => Promise<unknown> } = {},
): GuildMember {
  const roleIds = new Set(initialRoleIds);

  const add =
    options.addImpl ??
    (async (roleId: string) => {
      roleIds.add(roleId);
    });

  return {
    id: discordId,
    roles: {
      cache: { has: (roleId: string) => roleIds.has(roleId) },
      add: vi.fn(add),
      remove: vi.fn(async (roleId: string) => {
        roleIds.delete(roleId);
      }),
    },
  } as unknown as GuildMember;
}

async function setupGuildWithVerifiedRole(): Promise<{
  guildId: string;
  guildConfig: GuildConfig;
  roleId: string;
}> {
  const guildId = uniqueGuildId();
  await getOrCreateGuildConfig(guildId);
  const roleId = `role-${randomUUID()}`;
  const guildConfig = await updateGuildConfig(guildId, { verifiedRoleId: roleId });
  return { guildId, guildConfig, roleId };
}

describe('verificationService', () => {
  describe('ensureMemberTracked', () => {
    it('legt einen neuen Member mit Status PENDING an', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const member = await ensureMemberTracked(guildId, 'discord-user-1');

      expect(member.verificationStatus).toBe('PENDING');
      expect(member.verifiedAt).toBeNull();
    });
  });

  describe('setMemberVerification', () => {
    it('wirft ValidationError, wenn beim Verifizieren keine Verifiziert-Rolle konfiguriert ist', async () => {
      const guildId = uniqueGuildId();
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeGuildMember('discord-user-1');

      await expect(
        setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('erlaubt das Zuruecksetzen auf PENDING/REJECTED auch ohne konfigurierte Rolle', async () => {
      const guildId = uniqueGuildId();
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeGuildMember('discord-user-1');

      const result = await setMemberVerification(member, guildConfig, 'REJECTED', 'actor-1');

      expect(result.changed).toBe(true);
      expect(result.member.verificationStatus).toBe('REJECTED');
    });

    it('verifiziert ein Mitglied: vergibt die Rolle, aktualisiert die DB und schreibt einen Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig, roleId } = await setupGuildWithVerifiedRole();
      const member = fakeGuildMember('discord-user-1');

      const result = await setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1');

      expect(result.changed).toBe(true);
      expect(result.member.verificationStatus).toBe('VERIFIED');
      expect(result.member.verifiedAt).not.toBeNull();
      expect(member.roles.add).toHaveBeenCalledTimes(1);
      expect(member.roles.add).toHaveBeenCalledWith(roleId, expect.any(String));

      const stored = await getMember(guildId, 'discord-user-1');
      expect(stored?.verificationStatus).toBe('VERIFIED');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'discord-user-1' });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe('member.verify');
      expect(auditEntries[0]?.actorDiscordId).toBe('actor-1');
    });

    it('ist idempotent: erneutes Verifizieren aendert nichts und vergibt die Rolle nicht doppelt', async () => {
      const { guildId, guildConfig } = await setupGuildWithVerifiedRole();
      const member = fakeGuildMember('discord-user-1');

      await setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1');
      const secondResult = await setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1');

      expect(secondResult.changed).toBe(false);
      expect(member.roles.add).toHaveBeenCalledTimes(1);

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'discord-user-1' });
      expect(auditEntries).toHaveLength(1);
    });

    it('entzieht beim Ablehnen eines bereits verifizierten Mitglieds die Rolle und setzt verifiedAt zurueck', async () => {
      const { guildId, guildConfig, roleId } = await setupGuildWithVerifiedRole();
      const member = fakeGuildMember('discord-user-1', [roleId]);

      const result = await setMemberVerification(member, guildConfig, 'REJECTED', 'actor-admin');

      expect(result.changed).toBe(true);
      expect(result.member.verificationStatus).toBe('REJECTED');
      expect(result.member.verifiedAt).toBeNull();
      expect(member.roles.remove).toHaveBeenCalledWith(roleId, expect.any(String));

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: 'discord-user-1' });
      expect(auditEntries[0]?.action).toBe('member.reject');
      expect(auditEntries[0]?.actorDiscordId).toBe('actor-admin');
    });

    it('uebersetzt fehlende Bot-Berechtigungen (Discord-Fehlercode 50013) in eine verstaendliche ValidationError', async () => {
      const { guildConfig } = await setupGuildWithVerifiedRole();
      const member = fakeGuildMember('discord-user-1', [], {
        addImpl: async () => {
          throw new DiscordAPIError(
            { code: 50013, message: 'Missing Permissions' },
            50013,
            403,
            'PUT',
            '/guilds/x/members/y/roles/z',
            { body: undefined, files: undefined },
          );
        },
      });

      await expect(
        setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('reicht unbekannte Fehler beim Rollenzugriff unveraendert weiter', async () => {
      const { guildConfig } = await setupGuildWithVerifiedRole();
      const member = fakeGuildMember('discord-user-1', [], {
        addImpl: async () => {
          throw new Error('Netzwerkfehler');
        },
      });

      await expect(
        setMemberVerification(member, guildConfig, 'VERIFIED', 'actor-1'),
      ).rejects.toThrow('Netzwerkfehler');
    });
  });
});

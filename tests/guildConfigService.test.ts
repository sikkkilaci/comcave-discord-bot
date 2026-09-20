import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits, PermissionsBitField, type GuildMember, type Role } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { configureAdminRoles } from '../src/services/guildConfigService.js';
import { hasPermissionLevel, isServerAdmin } from '../src/permissions/checkPermission.js';
import { PermissionLevel } from '../src/permissions/PermissionLevel.js';
import { ValidationError } from '../src/utils/errors.js';

function fakeRole(options: { id: string; name?: string; isAdministrator?: boolean }): Role {
  return {
    id: options.id,
    name: options.name ?? options.id,
    permissions: new PermissionsBitField(
      options.isAdministrator
        ? PermissionFlagsBits.Administrator
        : PermissionFlagsBits.SendMessages,
    ),
  } as unknown as Role;
}

function fakeMember(options: { id: string; ownerId?: string; roleIds?: string[] }): GuildMember {
  const roleIds = new Set(options.roleIds ?? []);
  return {
    id: options.id,
    guild: { ownerId: options.ownerId ?? 'someone-else' },
    permissions: { has: () => false },
    roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
  } as unknown as GuildMember;
}

describe('configureAdminRoles', () => {
  it('konfiguriert eine gueltige Admin-Rolle erfolgreich', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });

    const updated = await configureAdminRoles(guildId, { adminRole }, 'actor-1');

    expect(updated.adminRoleId).toBe('role-admin');
  });

  it('ein Mitglied mit der konfigurierten Admin-Rolle gilt danach als Server-Admin', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });
    await configureAdminRoles(guildId, { adminRole }, 'actor-1');

    const guildConfig = await getOrCreateGuildConfig(guildId);
    const memberWithRole = fakeMember({ id: 'member-1', roleIds: ['role-admin'] });

    expect(isServerAdmin(memberWithRole, guildConfig)).toBe(true);
    expect(await hasPermissionLevel(memberWithRole, guildConfig, PermissionLevel.ADMIN)).toBe(true);
  });

  it('konfiguriert eine gueltige Moderator-Rolle erfolgreich', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });
    const moderatorRole = fakeRole({ id: 'role-mod' });

    const updated = await configureAdminRoles(guildId, { adminRole, moderatorRole }, 'actor-1');

    expect(updated.moderatorRoleId).toBe('role-mod');
  });

  it('eine konfigurierte Moderator-Rolle verleiht aktuell KEINE zusaetzlichen Berechtigungen (noch kein PermissionLevel.MODERATOR)', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });
    const moderatorRole = fakeRole({ id: 'role-mod' });
    await configureAdminRoles(guildId, { adminRole, moderatorRole }, 'actor-1');

    const guildConfig = await getOrCreateGuildConfig(guildId);
    const memberWithModRole = fakeMember({ id: 'member-mod', roleIds: ['role-mod'] });

    expect(isServerAdmin(memberWithModRole, guildConfig)).toBe(false);
    expect(await hasPermissionLevel(memberWithModRole, guildConfig, PermissionLevel.ADMIN)).toBe(
      false,
    );
    expect(
      await hasPermissionLevel(memberWithModRole, guildConfig, PermissionLevel.KLASSENLEITUNG),
    ).toBe(false);
    expect(await hasPermissionLevel(memberWithModRole, guildConfig, PermissionLevel.VERIFIED)).toBe(
      false,
    );
  });

  it('ein normales Mitglied ohne jede konfigurierte Rolle bleibt EVERYONE', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const member = fakeMember({ id: 'member-1' });

    expect(isServerAdmin(member, guildConfig)).toBe(false);
    expect(await hasPermissionLevel(member, guildConfig, PermissionLevel.EVERYONE)).toBe(true);
    expect(await hasPermissionLevel(member, guildConfig, PermissionLevel.VERIFIED)).toBe(false);
    expect(await hasPermissionLevel(member, guildConfig, PermissionLevel.ADMIN)).toBe(false);
  });

  it('lehnt eine Admin-Rolle mit Administrator-Berechtigung ab (ungueltige Rolle)', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin', isAdministrator: true });

    await expect(configureAdminRoles(guildId, { adminRole }, 'actor-1')).rejects.toBeInstanceOf(
      ValidationError,
    );

    const guildConfig = await getOrCreateGuildConfig(guildId);
    expect(guildConfig.adminRoleId).toBeNull();
  });

  it('lehnt eine Moderator-Rolle mit Administrator-Berechtigung ab (ungueltige Rolle)', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });
    const moderatorRole = fakeRole({ id: 'role-mod', isAdministrator: true });

    await expect(
      configureAdminRoles(guildId, { adminRole, moderatorRole }, 'actor-1'),
    ).rejects.toBeInstanceOf(ValidationError);

    const guildConfig = await getOrCreateGuildConfig(guildId);
    expect(guildConfig.adminRoleId).toBeNull();
    expect(guildConfig.moderatorRoleId).toBeNull();
  });

  it('fail-closed: ohne konfigurierte Admin-Rolle ist niemand ueber eine Rolle Server-Admin (fehlende Konfiguration)', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const memberWithArbitraryRole = fakeMember({ id: 'member-1', roleIds: ['irgendeine-rolle'] });

    expect(isServerAdmin(memberWithArbitraryRole, guildConfig)).toBe(false);
  });

  it('schreibt einen "admin.roles.setup"-Audit-Log-Eintrag', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });

    await configureAdminRoles(guildId, { adminRole }, 'actor-1');

    const entries = await listAuditEvents(guildId);
    expect(entries.some((e) => e.action === 'admin.roles.setup')).toBe(true);
  });

  it('laesst eine bereits gesetzte Moderator-Rolle unveraendert, wenn sie nicht angegeben wird', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const adminRole = fakeRole({ id: 'role-admin' });
    const moderatorRole = fakeRole({ id: 'role-mod' });
    await configureAdminRoles(guildId, { adminRole, moderatorRole }, 'actor-1');

    const updated = await configureAdminRoles(
      guildId,
      { adminRole: fakeRole({ id: 'role-admin-2' }) },
      'actor-1',
    );

    expect(updated.moderatorRoleId).toBe('role-mod');
  });
});

import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { isServerAdmin, isVerified } from '../src/permissions/checkPermission.js';

function fakeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    id: 'guild-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    adminRoleId: null,
    moderatorRoleId: null,
    verifiedRoleId: null,
    logChannelId: null,
    welcomeChannelId: null,
    whereAmIChannelId: null,
    ...overrides,
  };
}

function fakeMember(options: {
  id: string;
  ownerId: string;
  isAdministrator?: boolean;
  roleIds?: string[];
}): GuildMember {
  const roleIds = options.roleIds ?? [];
  return {
    id: options.id,
    guild: { ownerId: options.ownerId },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, roleId])) },
  } as unknown as GuildMember;
}

describe('isServerAdmin', () => {
  it('erkennt den Server-Besitzer als Admin', () => {
    const member = fakeMember({ id: 'user-1', ownerId: 'user-1' });
    expect(isServerAdmin(member, fakeGuildConfig())).toBe(true);
  });

  it('erkennt Discord-Administrator-Rechte als Admin', () => {
    const member = fakeMember({ id: 'user-2', ownerId: 'owner', isAdministrator: true });
    expect(isServerAdmin(member, fakeGuildConfig())).toBe(true);
  });

  it('erkennt die konfigurierte Admin-Rolle als Admin', () => {
    const member = fakeMember({ id: 'user-3', ownerId: 'owner', roleIds: ['role-admin'] });
    expect(isServerAdmin(member, fakeGuildConfig({ adminRoleId: 'role-admin' }))).toBe(true);
  });

  it('gibt false zurueck, wenn keine Admin-Bedingung erfuellt ist', () => {
    const member = fakeMember({ id: 'user-4', ownerId: 'owner' });
    expect(isServerAdmin(member, fakeGuildConfig({ adminRoleId: 'role-admin' }))).toBe(false);
  });
});

describe('isVerified', () => {
  it('gibt false zurueck, wenn keine Verifiziert-Rolle konfiguriert ist', () => {
    const member = fakeMember({ id: 'user-1', ownerId: 'owner' });
    expect(isVerified(member, fakeGuildConfig())).toBe(false);
  });

  it('erkennt Mitglieder mit der konfigurierten Verifiziert-Rolle', () => {
    const member = fakeMember({ id: 'user-1', ownerId: 'owner', roleIds: ['role-verified'] });
    expect(isVerified(member, fakeGuildConfig({ verifiedRoleId: 'role-verified' }))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
  isClassLeadOf,
  isServerAdmin,
  isVerified,
} from '../src/permissions/checkPermission.js';
import { PermissionError } from '../src/utils/errors.js';

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

const CLASS_A = { id: 'class-a', name: 'A', leadRoleId: 'role-lead-a' };
const CLASS_B = { id: 'class-b', name: 'B', leadRoleId: 'role-lead-b' };
const CLASS_C = { id: 'class-c', name: 'C', leadRoleId: 'role-lead-c' };
const CLASS_UNCONFIGURED = { id: 'class-a', name: 'A', leadRoleId: null };

describe('isClassLeadOf', () => {
  it('erkennt die Klassenleitung der eigenen Klasse', () => {
    const member = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(isClassLeadOf(member, CLASS_A)).toBe(true);
  });

  it('erkennt keine Klassenleitung, wenn die Klasse noch keine leadRoleId hat', () => {
    const member = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(isClassLeadOf(member, CLASS_UNCONFIGURED)).toBe(false);
  });

  it('erkennt keine Klassenleitung fuer eine andere Klasse', () => {
    const member = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(isClassLeadOf(member, CLASS_B)).toBe(false);
  });
});

describe('assertClassManagementAccess - Fail-Closed-Matrix (Anforderung: keine Manipulation ueber Klassen-ID moeglich)', () => {
  it('erlaubt globalen Admins den Zugriff auf jede Klasse', () => {
    const admin = fakeMember({ id: 'admin-1', ownerId: 'owner', isAdministrator: true });
    for (const klasse of [CLASS_A, CLASS_B, CLASS_C, CLASS_UNCONFIGURED]) {
      expect(() => assertClassManagementAccess(admin, fakeGuildConfig(), klasse)).not.toThrow();
    }
  });

  it('Klassenleitung A darf Klasse A verwalten', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassManagementAccess(leadA, fakeGuildConfig(), CLASS_A)).not.toThrow();
  });

  it('Klassenleitung A darf Klasse B NICHT verwalten', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassManagementAccess(leadA, fakeGuildConfig(), CLASS_B)).toThrow(
      PermissionError,
    );
  });

  it('Klassenleitung A darf Klasse C NICHT verwalten', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassManagementAccess(leadA, fakeGuildConfig(), CLASS_C)).toThrow(
      PermissionError,
    );
  });

  it('Klassenleitung B darf Klasse A NICHT verwalten', () => {
    const leadB = fakeMember({ id: 'lead-b', ownerId: 'owner', roleIds: ['role-lead-b'] });
    expect(() => assertClassManagementAccess(leadB, fakeGuildConfig(), CLASS_A)).toThrow(
      PermissionError,
    );
  });

  it('Klassenleitung C darf Klasse A NICHT verwalten', () => {
    const leadC = fakeMember({ id: 'lead-c', ownerId: 'owner', roleIds: ['role-lead-c'] });
    expect(() => assertClassManagementAccess(leadC, fakeGuildConfig(), CLASS_A)).toThrow(
      PermissionError,
    );
  });

  it('verweigert normalen Mitgliedern ohne jede Klassenleitungs-Rolle den Zugriff', () => {
    const member = fakeMember({ id: 'user-1', ownerId: 'owner' });
    expect(() => assertClassManagementAccess(member, fakeGuildConfig(), CLASS_A)).toThrow(
      PermissionError,
    );
  });

  it('verweigert fail-closed den Zugriff auf eine noch nicht konfigurierte Klasse (leadRoleId null), auch fuer eine andere Klassenleitung', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassManagementAccess(leadA, fakeGuildConfig(), CLASS_UNCONFIGURED)).toThrow(
      PermissionError,
    );
  });
});

describe('assertClassReadAccess', () => {
  it('erlaubt globalen Admins das Lesen jeder Klasse', () => {
    const admin = fakeMember({ id: 'admin-1', ownerId: 'owner', isAdministrator: true });
    expect(() => assertClassReadAccess(admin, fakeGuildConfig(), CLASS_B, null)).not.toThrow();
  });

  it('erlaubt der Klassenleitung das Lesen der eigenen Klasse', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassReadAccess(leadA, fakeGuildConfig(), CLASS_A, null)).not.toThrow();
  });

  it('verweigert der Klassenleitung das Lesen einer fremden Klasse', () => {
    const leadA = fakeMember({ id: 'lead-a', ownerId: 'owner', roleIds: ['role-lead-a'] });
    expect(() => assertClassReadAccess(leadA, fakeGuildConfig(), CLASS_B, null)).toThrow(
      PermissionError,
    );
  });

  it('erlaubt einem Mitglied das Lesen der eigenen Klasse (ownClassId stimmt ueberein)', () => {
    const member = fakeMember({ id: 'member-1', ownerId: 'owner' });
    expect(() =>
      assertClassReadAccess(member, fakeGuildConfig(), CLASS_A, CLASS_A.id),
    ).not.toThrow();
  });

  it('verweigert einem Mitglied das Lesen einer fremden Klasse', () => {
    const member = fakeMember({ id: 'member-1', ownerId: 'owner' });
    expect(() => assertClassReadAccess(member, fakeGuildConfig(), CLASS_B, CLASS_A.id)).toThrow(
      PermissionError,
    );
  });

  it('verweigert fail-closed, wenn das Mitglied ueberhaupt keiner Klasse zugeordnet ist', () => {
    const member = fakeMember({ id: 'member-1', ownerId: 'owner' });
    expect(() => assertClassReadAccess(member, fakeGuildConfig(), CLASS_A, null)).toThrow(
      PermissionError,
    );
  });
});

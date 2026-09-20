import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { updateClassLead, updateClassRole } from '../src/repositories/classRepository.js';
import { logAuditEvent } from '../src/repositories/auditLogRepository.js';
import { getAuditLogPage } from '../src/services/auditLogService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('getAuditLogPage', () => {
  it('ein globaler Admin darf das Audit-Log lesen', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const result = await getAuditLogPage(guildConfig, admin, 1);

    expect(result.entries).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });

  it('eine Klassenleitung darf das Audit-Log NICHT lesen', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await updateClassRole(guildId, 'A', `role-a-${randomUUID()}`);
    const leadRoleA = `lead-a-${randomUUID()}`;
    await updateClassLead(guildId, 'A', { leadRoleId: leadRoleA });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });

    const classLead = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    await expect(getAuditLogPage(guildConfig, classLead, 1)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('ein normales Mitglied darf das Audit-Log NICHT lesen', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    const member = fakeMember({ id: 'member-1' });

    await expect(getAuditLogPage(guildConfig, member, 1)).rejects.toBeInstanceOf(PermissionError);
  });

  it('vermischt keine Eintraege verschiedener Guilds (Guild-Isolation)', async () => {
    const guildIdA = `guild-${randomUUID()}`;
    const guildIdB = `guild-${randomUUID()}`;
    const guildConfigA = await getOrCreateGuildConfig(guildIdA);
    await getOrCreateGuildConfig(guildIdB);
    await logAuditEvent({ guildId: guildIdA, actorDiscordId: 'actor-1', action: 'class.setup' });
    await logAuditEvent({
      guildId: guildIdB,
      actorDiscordId: 'actor-1',
      action: 'verification.setup',
    });
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const result = await getAuditLogPage(guildConfigA, admin, 1);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.action).toBe('class.setup');
  });

  it('gibt eine leere Seite fuer ein leeres Audit-Log zurueck', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const result = await getAuditLogPage(guildConfig, admin, 1);

    expect(result.entries).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it('liefert mehrere Eintraege korrekt sortiert (neueste zuerst)', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'event.1' });
    await wait(5);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'event.2' });
    await wait(5);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'event.3' });
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const result = await getAuditLogPage(guildConfig, admin, 1);

    expect(result.entries.map((e) => e.action)).toEqual(['event.3', 'event.2', 'event.1']);
  });

  it('paginiert korrekt ueber mehrere Seiten', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    for (let i = 0; i < 15; i += 1) {
      await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: `event.${i}` });
    }
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const firstPage = await getAuditLogPage(guildConfig, admin, 1);
    const secondPage = await getAuditLogPage(guildConfig, admin, 2);

    expect(firstPage.entries).toHaveLength(10);
    expect(secondPage.entries).toHaveLength(5);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.totalCount).toBe(15);
  });

  it('filtert nach Aktion und ausfuehrendem Nutzer', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-2', action: 'class.setup' });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'verification.setup' });
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const byAction = await getAuditLogPage(guildConfig, admin, 1, { aktion: 'class.setup' });
    expect(byAction.totalCount).toBe(2);

    const byActor = await getAuditLogPage(guildConfig, admin, 1, {
      ausfuehrenderDiscordId: 'actor-1',
    });
    expect(byActor.totalCount).toBe(2);
  });

  it('lehnt eine ungueltige Seitenzahl ab', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await expect(getAuditLogPage(guildConfig, admin, 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it('lehnt eine Seitenzahl jenseits der letzten Seite ab', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await expect(getAuditLogPage(guildConfig, admin, 5)).rejects.toBeInstanceOf(ValidationError);
  });
});

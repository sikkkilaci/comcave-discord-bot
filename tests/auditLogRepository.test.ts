import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { listAuditEvents, logAuditEvent } from '../src/repositories/auditLogRepository.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

describe('auditLogRepository', () => {
  it('schreibt einen Eintrag mit allen Feldern', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.verify',
      targetDiscordId: 'target-1',
      metadata: { via: 'button' },
    });

    const entries = await listAuditEvents(guildId);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.verify',
      targetDiscordId: 'target-1',
    });
    expect(JSON.parse(entries[0]?.metadata ?? '{}')).toEqual({ via: 'button' });
  });

  it('speichert targetDiscordId und metadata als null, wenn nicht angegeben', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'member.reset' });

    const entries = await listAuditEvents(guildId);

    expect(entries[0]?.targetDiscordId).toBeNull();
    expect(entries[0]?.metadata).toBeNull();
  });

  it('filtert nach targetDiscordId', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.verify',
      targetDiscordId: 'a',
    });
    await logAuditEvent({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.verify',
      targetDiscordId: 'b',
    });

    const entries = await listAuditEvents(guildId, { targetDiscordId: 'a' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetDiscordId).toBe('a');
  });

  it('liefert neueste Eintraege zuerst', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.verify',
      targetDiscordId: 'x',
    });
    // Kleine Pause, damit sich createdAt zwischen den Eintraegen unterscheidet
    // (SQLite-Timestamp-Aufloesung ist nicht feiner als 1ms).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await logAuditEvent({
      guildId,
      actorDiscordId: 'actor-1',
      action: 'member.reject',
      targetDiscordId: 'x',
    });

    const entries = await listAuditEvents(guildId, { targetDiscordId: 'x' });

    expect(entries.map((entry) => entry.action)).toEqual(['member.reject', 'member.verify']);
  });
});

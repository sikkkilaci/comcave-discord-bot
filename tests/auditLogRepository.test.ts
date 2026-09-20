import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  countAuditEvents,
  listAuditEvents,
  logAuditEvent,
} from '../src/repositories/auditLogRepository.js';

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

  it('filtert nach actorDiscordId und action', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-2', action: 'class.setup' });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'verification.setup' });

    const byActor = await listAuditEvents(guildId, { actorDiscordId: 'actor-1' });
    expect(byActor).toHaveLength(2);

    const byAction = await listAuditEvents(guildId, { action: 'class.setup' });
    expect(byAction).toHaveLength(2);

    const byBoth = await listAuditEvents(guildId, {
      actorDiscordId: 'actor-1',
      action: 'class.setup',
    });
    expect(byBoth).toHaveLength(1);
  });

  it('unterstuetzt Paginierung ueber take/skip', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    for (let i = 0; i < 5; i += 1) {
      await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: `event.${i}` });
    }

    const firstPage = await listAuditEvents(guildId, { take: 2, skip: 0 });
    const secondPage = await listAuditEvents(guildId, { take: 2, skip: 2 });

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(2);
    expect(firstPage.map((e) => e.action)).not.toEqual(secondPage.map((e) => e.action));
  });

  it('countAuditEvents zaehlt mit denselben Filtern wie listAuditEvents', async () => {
    const guildId = uniqueGuildId();
    await getOrCreateGuildConfig(guildId);

    await logAuditEvent({ guildId, actorDiscordId: 'actor-1', action: 'class.setup' });
    await logAuditEvent({ guildId, actorDiscordId: 'actor-2', action: 'class.setup' });

    expect(await countAuditEvents(guildId)).toBe(2);
    expect(await countAuditEvents(guildId, { actorDiscordId: 'actor-1' })).toBe(1);
  });

  it('vermischt keine Eintraege verschiedener Guilds (Guild-Isolation)', async () => {
    const guildIdA = uniqueGuildId();
    const guildIdB = uniqueGuildId();
    await getOrCreateGuildConfig(guildIdA);
    await getOrCreateGuildConfig(guildIdB);

    await logAuditEvent({ guildId: guildIdA, actorDiscordId: 'actor-1', action: 'class.setup' });
    await logAuditEvent({ guildId: guildIdB, actorDiscordId: 'actor-1', action: 'class.setup' });

    expect(await countAuditEvents(guildIdA)).toBe(1);
    expect(await countAuditEvents(guildIdB)).toBe(1);
  });
});

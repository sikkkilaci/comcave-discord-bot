import { describe, expect, it } from 'vitest';
import { buildAuditLogEmbed } from '../src/bot/ui/auditLogMessage.js';
import type { AuditLogPage } from '../src/services/auditLogService.js';

function fakeEntry(overrides: Partial<AuditLogPage['entries'][number]> = {}) {
  return {
    id: 'entry-1',
    guildId: 'guild-1',
    actorDiscordId: 'actor-1',
    action: 'class.setup',
    targetDiscordId: null,
    metadata: null,
    createdAt: new Date('2027-01-01T10:00:00.000Z'),
    ...overrides,
  } as AuditLogPage['entries'][number];
}

describe('buildAuditLogEmbed', () => {
  it('zeigt einen Hinweis bei leerem Audit-Log', () => {
    const embed = buildAuditLogEmbed({
      entries: [],
      page: 1,
      pageSize: 10,
      totalCount: 0,
      totalPages: 1,
    });

    expect(embed.toJSON().description).toContain('keine Audit-Log-Eintraege');
  });

  it('zeigt ausfuehrenden Nutzer und Aktion pro Eintrag', () => {
    const embed = buildAuditLogEmbed({
      entries: [fakeEntry()],
      page: 1,
      pageSize: 10,
      totalCount: 1,
      totalPages: 1,
    });

    const field = embed.toJSON().fields?.[0];
    expect(field?.name).toContain('class.setup');
    expect(field?.value).toContain('<@actor-1>');
  });

  it('zeigt den betroffenen Nutzer, wenn targetDiscordId gesetzt ist', () => {
    const embed = buildAuditLogEmbed({
      entries: [fakeEntry({ targetDiscordId: 'target-1' })],
      page: 1,
      pageSize: 10,
      totalCount: 1,
      totalPages: 1,
    });

    expect(embed.toJSON().fields?.[0]?.value).toContain('<@target-1>');
  });

  it('liest die Klasse aus den Metadaten aus, wenn vorhanden', () => {
    const embed = buildAuditLogEmbed({
      entries: [fakeEntry({ metadata: JSON.stringify({ className: 'A' }) })],
      page: 1,
      pageSize: 10,
      totalCount: 1,
      totalPages: 1,
    });

    expect(embed.toJSON().fields?.[0]?.value).toContain('Klasse: A');
  });

  it('ignoriert ungueltiges JSON in metadata, statt zu werfen', () => {
    expect(() =>
      buildAuditLogEmbed({
        entries: [fakeEntry({ metadata: 'nicht-json' })],
        page: 1,
        pageSize: 10,
        totalCount: 1,
        totalPages: 1,
      }),
    ).not.toThrow();
  });

  it('zeigt die Seiten- und Gesamtanzahl im Footer', () => {
    const embed = buildAuditLogEmbed({
      entries: [fakeEntry()],
      page: 2,
      pageSize: 10,
      totalCount: 15,
      totalPages: 2,
    });

    expect(embed.toJSON().footer?.text).toContain('Seite 2/2');
    expect(embed.toJSON().footer?.text).toContain('15');
  });
});

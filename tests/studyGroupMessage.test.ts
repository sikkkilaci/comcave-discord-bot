import { describe, expect, it } from 'vitest';
import {
  buildStudyGroupListEmbed,
  buildStudyGroupStatusEmbed,
} from '../src/bot/ui/studyGroupMessage.js';
import type {
  StudyGroupListItem,
  StudyGroupStatusItem,
} from '../src/services/studyGroupService.js';
import type { StudyGroup } from '@prisma/client';

function fakeGroup(overrides: Partial<StudyGroup> = {}): StudyGroup {
  return {
    id: 'group-1',
    guildId: 'guild-1',
    classId: 'class-1',
    name: 'Testgruppe',
    createdByDiscordId: 'creator-1',
    isActive: true,
    closedAt: null,
    closedByDiscordId: null,
    maxParticipants: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildStudyGroupListEmbed', () => {
  it('zeigt einen Hinweis, wenn keine Gruppen vorhanden sind', () => {
    const embed = buildStudyGroupListEmbed('A', [], null).toJSON();
    expect(embed.description).toContain('keine Lerngruppen');
  });

  it('zeigt Name, Teilnehmerzahl und ID pro Gruppe', () => {
    const items: StudyGroupListItem[] = [
      { group: fakeGroup({ maxParticipants: 5 }), memberCount: 2 },
    ];

    const embed = buildStudyGroupListEmbed('A', items, null).toJSON();

    expect(embed.fields?.[0]?.name).toBe('Testgruppe');
    expect(embed.fields?.[0]?.value).toContain('2/5');
    expect(embed.fields?.[0]?.value).toContain('group-1');
  });

  it('zeigt den Klassen-Voice-Kanal in der Beschreibung, wenn konfiguriert', () => {
    const items: StudyGroupListItem[] = [{ group: fakeGroup(), memberCount: 1 }];

    const embed = buildStudyGroupListEmbed('A', items, 'voice-channel-1').toJSON();

    expect(embed.description).toContain('<#voice-channel-1>');
  });
});

describe('buildStudyGroupStatusEmbed', () => {
  it('zeigt einen Hinweis, wenn keine Gruppen vorhanden sind', () => {
    const embed = buildStudyGroupStatusEmbed('A', []).toJSON();
    expect(embed.description).toContain('keine Lerngruppen');
  });

  it('zeigt Status, Mitglieder als Erwaehnungen und ID pro Gruppe', () => {
    const items: StudyGroupStatusItem[] = [
      { group: fakeGroup(), memberDiscordIds: ['member-1', 'member-2'] },
    ];

    const embed = buildStudyGroupStatusEmbed('A', items).toJSON();

    expect(embed.fields?.[0]?.value).toContain('aktiv');
    expect(embed.fields?.[0]?.value).toContain('<@member-1>');
    expect(embed.fields?.[0]?.value).toContain('<@member-2>');
  });

  it('zeigt den Schliess-Zeitpunkt fuer geschlossene Gruppen', () => {
    const items: StudyGroupStatusItem[] = [
      {
        group: fakeGroup({ isActive: false, closedAt: new Date('2026-09-20T10:00:00.000Z') }),
        memberDiscordIds: [],
      },
    ];

    const embed = buildStudyGroupStatusEmbed('A', items).toJSON();

    expect(embed.fields?.[0]?.value).toContain('geschlossen am');
  });
});

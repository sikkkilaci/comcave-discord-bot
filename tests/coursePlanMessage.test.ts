import { describe, expect, it } from 'vitest';
import {
  buildCoursePlanAckCustomId,
  buildCoursePlanOverviewMessage,
  buildCoursePlanStatusEmbed,
  buildUpcomingCourseNoticeEmbed,
  parseCoursePlanAckCustomId,
} from '../src/bot/ui/coursePlanMessage.js';
import type {
  CoursePlanOverviewResult,
  CoursePlanStatusResult,
} from '../src/services/coursePlanService.js';
import type { CourseEntry } from '@prisma/client';

function fakeCourseEntry(overrides: Partial<CourseEntry> = {}): CourseEntry {
  return {
    id: 'course-1',
    guildId: 'guild-1',
    classId: 'class-1',
    courseNumber: '12345',
    title: 'Testkurs',
    trainer: 'Frau Test',
    startDate: new Date('2026-09-15T00:00:00.000Z'),
    endDate: new Date('2026-09-25T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const BASE_OVERVIEW: CoursePlanOverviewResult = {
  className: 'A',
  hasOwnPlan: true,
  isoWeek: 38,
  isoWeekYear: 2026,
  currentEntry: fakeCourseEntry(),
  currentEntryAcknowledgedAt: null,
  nextEntry: null,
  currentSpecialDay: null,
};

describe('coursePlan customId', () => {
  it('baut und parst die Kenntnisnahme-customId verlustfrei', () => {
    const customId = buildCoursePlanAckCustomId('course-42');
    expect(parseCoursePlanAckCustomId(customId)).toBe('course-42');
  });

  it('erkennt eine fremde customId nicht als Kenntnisnahme-Button', () => {
    expect(parseCoursePlanAckCustomId('class:select:A')).toBeNull();
  });
});

describe('buildCoursePlanOverviewMessage', () => {
  it('zeigt fuer eine Klasse ohne eigenen Kursplan die vorgeschriebenen Status-Hinweise (B/C)', () => {
    const overview: CoursePlanOverviewResult = {
      ...BASE_OVERVIEW,
      className: 'B',
      hasOwnPlan: false,
      currentEntry: null,
    };

    const { embeds, components } = buildCoursePlanOverviewMessage(overview);
    const description = embeds[0]?.toJSON().description ?? '';

    expect(description).toContain('Für deine Klasse liegt aktuell noch kein eigener Kursplan vor.');
    expect(description).toContain('für Klasse B NICHT verbindlich');
    expect(description).toContain('Klassenleitung');
    expect(description).toContain('OverHead');
    expect(components).toHaveLength(0);
  });

  it('zeigt den "Kenntnis genommen"-Button, wenn ein aktueller Kurs noch nicht bestaetigt wurde', () => {
    const { components } = buildCoursePlanOverviewMessage(BASE_OVERVIEW);

    expect(components).toHaveLength(1);
    const button = components[0]?.toJSON().components[0] as unknown as { custom_id: string };
    expect(button.custom_id).toBe(buildCoursePlanAckCustomId('course-1'));
  });

  it('zeigt KEINEN Button mehr, wenn die Kenntnisnahme bereits bestaetigt wurde', () => {
    const overview: CoursePlanOverviewResult = {
      ...BASE_OVERVIEW,
      currentEntryAcknowledgedAt: new Date('2026-09-16T00:00:00.000Z'),
    };

    const { embeds, components } = buildCoursePlanOverviewMessage(overview);

    expect(components).toHaveLength(0);
    expect(embeds[0]?.toJSON().fields?.some((f) => f.value.includes('bestätigt'))).toBe(true);
  });

  it('zeigt "kein Kurs" ausdruecklich an, wenn aktuell kein Kurs stattfindet', () => {
    const overview: CoursePlanOverviewResult = { ...BASE_OVERVIEW, currentEntry: null };

    const { embeds, components } = buildCoursePlanOverviewMessage(overview);

    expect(embeds[0]?.toJSON().fields?.some((f) => f.value.includes('kein Kurs statt'))).toBe(true);
    expect(components).toHaveLength(0);
  });

  it('zeigt den naechsten Kurs an, wenn vorhanden', () => {
    const overview: CoursePlanOverviewResult = {
      ...BASE_OVERVIEW,
      nextEntry: fakeCourseEntry({ id: 'course-2', title: 'Naechster Kurs', trainer: null }),
    };

    const { embeds } = buildCoursePlanOverviewMessage(overview);
    const field = embeds[0]?.toJSON().fields?.find((f) => f.name.includes('Nächster Kurs'));

    expect(field?.name).toContain('Naechster Kurs');
    expect(field?.value).toContain('nicht angegeben');
  });
});

describe('buildCoursePlanStatusEmbed', () => {
  it('zeigt bestaetigte und ausstehende Mitglieder als Erwaehnungen', () => {
    const status: CoursePlanStatusResult = {
      className: 'A',
      currentEntry: fakeCourseEntry(),
      nextEntry: null,
      acknowledgedDiscordIds: ['member-1'],
      pendingDiscordIds: ['member-2', 'member-3'],
    };

    const embed = buildCoursePlanStatusEmbed(status).toJSON();
    const doneField = embed.fields?.find((f) => f.name.includes('bestätigt'));
    const pendingField = embed.fields?.find((f) => f.name.includes('ausstehend'));

    expect(doneField?.value).toContain('<@member-1>');
    expect(pendingField?.value).toContain('<@member-2>');
    expect(pendingField?.value).toContain('<@member-3>');
  });
});

describe('buildUpcomingCourseNoticeEmbed', () => {
  it('enthaelt Kurstitel und Kursnummer', () => {
    const embed = buildUpcomingCourseNoticeEmbed('A', fakeCourseEntry()).toJSON();

    expect(embed.description).toContain('Testkurs');
    expect(embed.description).toContain('12345');
  });
});

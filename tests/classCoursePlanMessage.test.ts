import { describe, expect, it } from 'vitest';
import type { CourseContentItem, CourseEntry } from '@prisma/client';
import {
  buildClassCoursePlanEmbed,
  buildClassCoursePlanFooterText,
} from '../src/bot/ui/classCoursePlanMessage.js';

function fakeEntry(overrides: Partial<CourseEntry> = {}): CourseEntry {
  return {
    id: 'entry-1',
    guildId: 'guild-1',
    classId: 'class-1',
    courseNumber: '567472',
    title: 'Testkurs',
    trainer: 'Frau Musterfrau',
    startDate: new Date(2026, 0, 5),
    endDate: new Date(2026, 0, 16),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeItem(overrides: Partial<CourseContentItem> = {}): CourseContentItem {
  return {
    id: 'item-1',
    courseNumber: '567472',
    courseTitle: 'Testkurs',
    orderIndex: 0,
    numberPath: '1',
    level: 1,
    text: 'Erster Punkt',
    sourceFile: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildClassCoursePlanFooterText', () => {
  it('enthaelt Kursnummer und CourseEntry-ID, damit ein Sync-Lauf die Nachricht wiederfindet', () => {
    expect(buildClassCoursePlanFooterText(fakeEntry({ id: 'abc', courseNumber: '567472' }))).toBe(
      'Kursnummer: 567472 · ID: abc',
    );
  });
});

describe('buildClassCoursePlanEmbed', () => {
  it('zeigt Zeitraum, Dozent und einen erklaerenden Hinweis ohne Kursinhalte', () => {
    const embed = buildClassCoursePlanEmbed(fakeEntry(), false, []);
    const data = embed.data;

    expect(data.title).toBe('Testkurs');
    expect(data.fields?.[0]).toMatchObject({ name: 'Zeitraum', value: '05.01.2026 – 16.01.2026' });
    expect(data.fields?.[1]).toMatchObject({ name: 'Dozent', value: 'Frau Musterfrau' });
    expect(data.description).toMatch(/noch keine Kursinhalte hinterlegt/);
    expect(data.footer?.text).toBe('Kursnummer: 567472 · ID: entry-1');
  });

  it('zeigt "nicht angegeben", wenn kein Dozent hinterlegt ist', () => {
    const embed = buildClassCoursePlanEmbed(fakeEntry({ trainer: null }), false, []);
    expect(embed.data.fields?.[1]).toMatchObject({ name: 'Dozent', value: 'nicht angegeben' });
  });

  it('markiert einen Klausur-Kurs deutlich im Titel und mit einem Hinweisfeld', () => {
    const embed = buildClassCoursePlanEmbed(fakeEntry(), true, []);
    const data = embed.data;

    expect(data.title).toBe('⚠️ Testkurs');
    expect(
      data.fields?.some((field) => field.name === 'Hinweis' && /Klausur/.test(field.value)),
    ).toBe(true);
  });

  it('formatiert die Kursgliederung hierarchisch eingerueckt, in Quellreihenfolge', () => {
    const embed = buildClassCoursePlanEmbed(fakeEntry(), false, [
      fakeItem({ id: '1', orderIndex: 0, numberPath: '1', level: 1, text: 'Kurstitel' }),
      fakeItem({ id: '2', orderIndex: 1, numberPath: '1.1', level: 2, text: 'Unterpunkt' }),
    ]);

    expect(embed.data.description).toBe('1. Kurstitel\n　1.1. Unterpunkt');
  });
});

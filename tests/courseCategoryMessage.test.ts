import { describe, expect, it } from 'vitest';
import { buildCourseCategoryEmbed } from '../src/bot/ui/courseCategoryMessage.js';
import type { CourseCatalogEntry } from '../src/services/courseCategoryService.js';

function baseEntry(overrides: Partial<CourseCatalogEntry> = {}): CourseCatalogEntry {
  return {
    courseNumber: '123456',
    courseTitle: 'Testkurs',
    start: new Date(2026, 0, 5),
    end: new Date(2026, 0, 16),
    hasExam: false,
    contentItems: [],
    ...overrides,
  };
}

describe('buildCourseCategoryEmbed', () => {
  it('zeigt Zeitraum und einen erklaerenden Hinweis, wenn noch keine Kursinhalte importiert sind', () => {
    const embed = buildCourseCategoryEmbed(baseEntry());
    const data = embed.data;

    expect(data.title).toBe('Testkurs');
    expect(data.fields?.[0]).toMatchObject({ name: 'Zeitraum', value: '05.01.2026 – 16.01.2026' });
    expect(data.description).toMatch(/noch keine Kursinhalte hinterlegt/);
  });

  it('markiert einen Klausur-Kurs deutlich im Titel und mit einem Hinweisfeld', () => {
    const embed = buildCourseCategoryEmbed(baseEntry({ hasExam: true }));
    const data = embed.data;

    expect(data.title).toBe('⚠️ Testkurs');
    expect(
      data.fields?.some((field) => field.name === 'Hinweis' && /Klausur/.test(field.value)),
    ).toBe(true);
  });

  it('formatiert die Kursgliederung hierarchisch eingerueckt, in Quellreihenfolge', () => {
    const embed = buildCourseCategoryEmbed(
      baseEntry({
        contentItems: [
          {
            id: '1',
            courseNumber: '123456',
            courseTitle: 'Testkurs',
            orderIndex: 0,
            numberPath: '1',
            level: 1,
            text: 'Kurstitel',
            sourceFile: 'x',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: '2',
            courseNumber: '123456',
            courseTitle: 'Testkurs',
            orderIndex: 1,
            numberPath: '1.1',
            level: 2,
            text: 'Unterpunkt',
            sourceFile: 'x',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );

    expect(embed.data.description).toBe('1. Kurstitel\n　1.1. Unterpunkt');
  });
});

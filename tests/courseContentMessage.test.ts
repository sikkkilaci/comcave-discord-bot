import { describe, expect, it } from 'vitest';
import { buildCourseContentEmbed } from '../src/bot/ui/courseContentMessage.js';
import type { CourseContentItem } from '@prisma/client';

function fakeItem(overrides: Partial<CourseContentItem> = {}): CourseContentItem {
  return {
    id: 'item-1',
    courseNumber: '567469',
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

describe('courseContentMessage', () => {
  describe('buildCourseContentEmbed - leerer Kurs', () => {
    it('zeigt einen erklaerenden Hinweis statt einer leeren Beschreibung', () => {
      const embed = buildCourseContentEmbed('567469', 'Testkurs', []);
      const data = embed.toJSON();

      expect(data.title).toBe('Kursinhalte - Testkurs');
      expect(data.description).toContain('keine Inhalte hinterlegt');
      expect(data.footer?.text).toBe('Kursnummer: 567469');
    });
  });

  describe('buildCourseContentEmbed - mit Inhalten', () => {
    it('rendert die Hierarchie mit zunehmender Einrueckung nach Ebene', () => {
      const items = [
        fakeItem({ id: '1', orderIndex: 0, numberPath: '1', level: 1, text: 'Grundlagen' }),
        fakeItem({ id: '2', orderIndex: 1, numberPath: '1.1', level: 2, text: 'Unterpunkt' }),
        fakeItem({ id: '3', orderIndex: 2, numberPath: '2', level: 1, text: 'Vertiefung' }),
      ];

      const embed = buildCourseContentEmbed('567469', 'Testkurs', items);
      const description = embed.toJSON().description ?? '';
      const lines = description.split('\n');

      expect(lines[0]).toBe('1. Grundlagen');
      expect(lines[1]).toBe('　1.1. Unterpunkt');
      expect(lines[2]).toBe('2. Vertiefung');
    });

    it('behaelt die Reihenfolge aus orderIndex bei (Quellreihenfolge)', () => {
      const items = [
        fakeItem({ id: '1', orderIndex: 0, numberPath: '1', level: 1, text: 'Erstens' }),
        fakeItem({ id: '2', orderIndex: 1, numberPath: '2', level: 1, text: 'Zweitens' }),
      ];

      const embed = buildCourseContentEmbed('567469', 'Testkurs', items);
      const description = embed.toJSON().description ?? '';

      expect(description.indexOf('Erstens')).toBeLessThan(description.indexOf('Zweitens'));
    });

    it('nutzt courseTitle aus dem ersten Item, wenn kein expliziter Titel uebergeben wird', () => {
      const items = [fakeItem({ courseTitle: 'Titel aus der Quelle' })];

      const embed = buildCourseContentEmbed('567469', null, items);

      expect(embed.toJSON().title).toBe('Kursinhalte - Titel aus der Quelle');
    });

    it('kuerzt eine zu lange Beschreibung auf das Discord-Limit von 4096 Zeichen', () => {
      const items = Array.from({ length: 300 }, (_, i) =>
        fakeItem({
          id: `item-${i}`,
          orderIndex: i,
          numberPath: String(i + 1),
          level: 1,
          text: 'x'.repeat(50),
        }),
      );

      const embed = buildCourseContentEmbed('567469', 'Testkurs', items);
      const description = embed.toJSON().description ?? '';

      expect(description.length).toBeLessThanOrEqual(4096);
      expect(description.endsWith('…')).toBe(true);
    });
  });
});

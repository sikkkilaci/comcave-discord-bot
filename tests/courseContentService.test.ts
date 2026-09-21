import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateClass } from '../src/repositories/classRepository.js';
import { upsertCourseEntry } from '../src/repositories/coursePlanRepository.js';
import { replaceCourseContentForCourse } from '../src/repositories/courseContentRepository.js';
import {
  getCourseContentByCourseNumber,
  getCourseContentForEntry,
} from '../src/services/courseContentService.js';

describe('courseContentService', () => {
  describe('getCourseContentForEntry', () => {
    it('ordnet einem CourseEntry die Inhalte derselben courseNumber zu (Kurs-ID als primaere Zuordnung)', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);
      const klasse = await getOrCreateClass(guildId, 'A');
      const courseNumber = `course-${randomUUID()}`;

      const { entry } = await upsertCourseEntry({
        guildId,
        classId: klasse.id,
        courseNumber,
        title: 'Testkurs',
        trainer: null,
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-09T00:00:00.000Z'),
        sourceFile: 'test.html',
        createdByDiscordId: 'admin-1',
      });

      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Testkurs',
          sourceFile: 'test.json',
        },
      ]);

      const content = await getCourseContentForEntry(entry);

      expect(content).toHaveLength(1);
      expect(content[0]?.courseNumber).toBe(courseNumber);
    });

    it('liefert eine leere Liste, wenn fuer die Kursnummer (noch) keine Inhalte importiert wurden', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);
      const klasse = await getOrCreateClass(guildId, 'A');

      const { entry } = await upsertCourseEntry({
        guildId,
        classId: klasse.id,
        courseNumber: `ohne-inhalte-${randomUUID()}`,
        title: 'Testkurs ohne Inhalte',
        trainer: null,
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-09T00:00:00.000Z'),
        sourceFile: 'test.html',
        createdByDiscordId: 'admin-1',
      });

      expect(await getCourseContentForEntry(entry)).toEqual([]);
    });
  });

  describe('getCourseContentByCourseNumber', () => {
    it('liefert Inhalte auch ohne vorhandenen CourseEntry (globaler Katalog)', async () => {
      const courseNumber = `course-${randomUUID()}`;
      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Katalog-Kurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Katalog-Kurs',
          sourceFile: 'test.json',
        },
      ]);

      const content = await getCourseContentByCourseNumber(courseNumber);

      expect(content).toHaveLength(1);
    });
  });
});

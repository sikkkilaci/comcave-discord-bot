import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  countCourseContentItems,
  countCoursesWithContent,
  listCourseContentByCourseNumber,
  replaceCourseContentForCourse,
} from '../src/repositories/courseContentRepository.js';

function uniqueCourseNumber(): string {
  return `course-${randomUUID()}`;
}

describe('courseContentRepository', () => {
  describe('replaceCourseContentForCourse', () => {
    it('legt neue Inhaltseintraege in Quellreihenfolge an', async () => {
      const courseNumber = uniqueCourseNumber();

      const result = await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Testkurs',
          sourceFile: 'test.json',
        },
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 1,
          numberPath: '1.1',
          level: 2,
          text: 'Erstes Unterkapitel',
          sourceFile: 'test.json',
        },
      ]);

      expect(result).toEqual({ created: 2, updated: 0, deleted: 0 });

      const items = await listCourseContentByCourseNumber(courseNumber);
      expect(items).toHaveLength(2);
      expect(items[0]?.numberPath).toBe('1');
      expect(items[1]?.numberPath).toBe('1.1');
    });

    it('ist idempotent: ein zweiter identischer Aufruf aktualisiert statt zu duplizieren', async () => {
      const courseNumber = uniqueCourseNumber();
      const items = [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Testkurs',
          sourceFile: 'test.json',
        },
      ];

      await replaceCourseContentForCourse(courseNumber, items);
      const second = await replaceCourseContentForCourse(courseNumber, items);

      expect(second).toEqual({ created: 0, updated: 1, deleted: 0 });
      expect(await listCourseContentByCourseNumber(courseNumber)).toHaveLength(1);
    });

    it('aktualisiert den Text eines bestehenden Eintrags anhand von orderIndex', async () => {
      const courseNumber = uniqueCourseNumber();
      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Alter Text',
          sourceFile: 'test.json',
        },
      ]);

      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Neuer Text',
          sourceFile: 'test.json',
        },
      ]);

      const items = await listCourseContentByCourseNumber(courseNumber);
      expect(items).toHaveLength(1);
      expect(items[0]?.text).toBe('Neuer Text');
    });

    it('entfernt Eintraege, die in einer aktualisierten Quelle nicht mehr enthalten sind', async () => {
      const courseNumber = uniqueCourseNumber();
      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Bleibt',
          sourceFile: 'test.json',
        },
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 1,
          numberPath: '1.1',
          level: 2,
          text: 'Faellt weg',
          sourceFile: 'test.json',
        },
      ]);

      const result = await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Bleibt',
          sourceFile: 'test.json',
        },
      ]);

      expect(result).toEqual({ created: 0, updated: 1, deleted: 1 });
      const items = await listCourseContentByCourseNumber(courseNumber);
      expect(items).toHaveLength(1);
      expect(items[0]?.text).toBe('Bleibt');
    });

    it('loescht alle Eintraege eines Kurses, wenn die neue Liste leer ist (keine kuenstliche Auffuellung)', async () => {
      const courseNumber = uniqueCourseNumber();
      await replaceCourseContentForCourse(courseNumber, [
        {
          courseNumber,
          courseTitle: 'Testkurs',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Wird geloescht',
          sourceFile: 'test.json',
        },
      ]);

      const result = await replaceCourseContentForCourse(courseNumber, []);

      expect(result).toEqual({ created: 0, updated: 0, deleted: 1 });
      expect(await listCourseContentByCourseNumber(courseNumber)).toHaveLength(0);
    });
  });

  describe('countCourseContentItems / countCoursesWithContent', () => {
    it('zaehlt Eintraege und Kurse mit Inhalten korrekt', async () => {
      const courseA = uniqueCourseNumber();
      const courseB = uniqueCourseNumber();
      const beforeItems = await countCourseContentItems();
      const beforeCourses = await countCoursesWithContent();

      await replaceCourseContentForCourse(courseA, [
        {
          courseNumber: courseA,
          courseTitle: 'Kurs A',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Kurs A',
          sourceFile: 'test.json',
        },
      ]);
      await replaceCourseContentForCourse(courseB, [
        {
          courseNumber: courseB,
          courseTitle: 'Kurs B',
          orderIndex: 0,
          numberPath: '1',
          level: 1,
          text: 'Kurs B',
          sourceFile: 'test.json',
        },
        {
          courseNumber: courseB,
          courseTitle: 'Kurs B',
          orderIndex: 1,
          numberPath: '1.1',
          level: 2,
          text: 'Unterpunkt',
          sourceFile: 'test.json',
        },
      ]);

      expect(await countCourseContentItems()).toBe(beforeItems + 3);
      expect(await countCoursesWithContent()).toBe(beforeCourses + 2);
    });
  });
});

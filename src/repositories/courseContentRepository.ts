import type { CourseContentItem } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface UpsertCourseContentItemInput {
  courseNumber: string;
  courseTitle: string;
  orderIndex: number;
  numberPath: string;
  level: number;
  text: string;
  sourceFile: string;
}

export interface ReplaceCourseContentResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Ersetzt den kompletten Inhaltsbestand eines Kurses (per `courseNumber`)
 * durch die uebergebenen Eintraege - im Gegensatz zu upsertLocation()/
 * upsertCourseEntry() (die einzelne, langlebige Datensaetze pflegen) ist
 * `orderIndex` eine reine Positionsangabe ohne externe Referenzen (kein
 * anderes Modell verweist per FK auf CourseContentItem.id), daher ist ein
 * "alles fuer diesen Kurs ersetzen"-Ansatz hier sicher und einfacher als ein
 * inkrementelles Deaktivieren wie beim Standort-Katalog. Ein Kurs ohne
 * Eintraege (leeres `items`-Array) loescht dadurch konsequent alle
 * vorhandenen Zeilen fuer diese `courseNumber` - es werden nie Inhalte
 * kuenstlich stehen gelassen oder aufgefuellt.
 */
export async function replaceCourseContentForCourse(
  courseNumber: string,
  items: UpsertCourseContentItemInput[],
): Promise<ReplaceCourseContentResult> {
  const keepIndexes = items.map((item) => item.orderIndex);

  const deleteResult = await prisma.courseContentItem.deleteMany({
    where: { courseNumber, orderIndex: { notIn: keepIndexes } },
  });

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const existing = await prisma.courseContentItem.findUnique({
      where: { courseNumber_orderIndex: { courseNumber, orderIndex: item.orderIndex } },
    });

    await prisma.courseContentItem.upsert({
      where: { courseNumber_orderIndex: { courseNumber, orderIndex: item.orderIndex } },
      update: {
        courseTitle: item.courseTitle,
        numberPath: item.numberPath,
        level: item.level,
        text: item.text,
        sourceFile: item.sourceFile,
      },
      create: item,
    });

    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated, deleted: deleteResult.count };
}

/**
 * Liefert die Inhalte eines Kurses in Quellreihenfolge - Grundlage fuer die
 * Verknuepfung mit einem CourseEntry ueber dessen `courseNumber` (siehe
 * courseContentService.ts).
 */
export async function listCourseContentByCourseNumber(
  courseNumber: string,
): Promise<CourseContentItem[]> {
  return prisma.courseContentItem.findMany({
    where: { courseNumber },
    orderBy: { orderIndex: 'asc' },
  });
}

export async function countCourseContentItems(): Promise<number> {
  return prisma.courseContentItem.count();
}

/** Anzahl unterschiedlicher Kurse, fuer die mindestens ein Inhaltseintrag existiert. */
export async function countCoursesWithContent(): Promise<number> {
  const rows = await prisma.courseContentItem.findMany({
    distinct: ['courseNumber'],
    select: { courseNumber: true },
  });
  return rows.length;
}

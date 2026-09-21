import type { CourseContentItem, CourseEntry } from '@prisma/client';
import { listCourseContentByCourseNumber } from '../repositories/courseContentRepository.js';

/**
 * Loest die Kursinhalte zu einem bestehenden CourseEntry auf - die
 * Verknuepfung erfolgt bewusst nur ueber den gemeinsamen Wert
 * `courseNumber` (kein FK, siehe CourseContentItem in prisma/schema.prisma),
 * da CourseEntry pro Klasse/Guild dupliziert wird, waehrend der Inhalt genau
 * einmal global im Katalog liegt. Leeres Ergebnis bedeutet entweder "fuer
 * diesen Kurs gibt es laut Quelle keine Inhalte" oder "die Kursinhalte
 * wurden fuer diese Kursnummer noch nicht importiert" - beides fail-safe
 * (leere Liste statt Fehler), da Inhalte reine Zusatzinformation sind.
 *
 * Aktuell bewusst noch OHNE eigenes Discord-UI/-Command verdrahtet (siehe
 * ARCHITECTURE.md, Abschnitt "Kursinhalte") - dient als vorbereiteter
 * Einstiegspunkt fuer eine spaetere Erweiterung von /kursplan bzw. einen
 * neuen Befehl.
 */
export async function getCourseContentForEntry(
  entry: Pick<CourseEntry, 'courseNumber'>,
): Promise<CourseContentItem[]> {
  return listCourseContentByCourseNumber(entry.courseNumber);
}

/** Wie getCourseContentForEntry(), aber direkt per Kursnummer (z. B. fuer eine kuenftige Katalog-Ansicht ohne vorhandenen CourseEntry). */
export async function getCourseContentByCourseNumber(
  courseNumber: string,
): Promise<CourseContentItem[]> {
  return listCourseContentByCourseNumber(courseNumber);
}

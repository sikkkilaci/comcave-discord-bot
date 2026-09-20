import { ValidationError } from './errors.js';

const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * Parst Datum (`TT.MM.JJJJ`) und Uhrzeit (`HH:MM`) aus zwei getrennten
 * Slash-Command-Optionen zu einem einzelnen `Date`. Getrennt statt eines
 * kombinierten Feldes, weil das der in der Anforderung genannten Eingabeform
 * ("Datum und Uhrzeit") entspricht und in Discord-Slash-Commands zwei kurze
 * Textfelder komfortabler auszufuellen sind als ein langes.
 *
 * Prueft zusaetzlich zur reinen Formatpruefung, dass das Datum tatsaechlich
 * existiert (JS' `Date`-Konstruktor rollt z. B. den 30. Februar sonst
 * stillschweigend auf den 2. Maerz um) - wirft andernfalls eine
 * `ValidationError` statt ein falsches Datum zu speichern.
 */
export function parseGermanDateTime(datum: string, uhrzeit: string): Date {
  const dateMatch = DATE_PATTERN.exec(datum.trim());
  const timeMatch = TIME_PATTERN.exec(uhrzeit.trim());

  if (!dateMatch || !timeMatch) {
    throw new ValidationError(
      'Datum muss im Format TT.MM.JJJJ (z. B. 24.12.2026) und Uhrzeit im Format HH:MM ' +
        '(z. B. 14:30) angegeben werden.',
    );
  }

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    throw new ValidationError('Ungueltige Uhrzeit - Stunden muessen 00-23, Minuten 00-59 sein.');
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const isRealDate =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  if (!isRealDate) {
    throw new ValidationError(`${datum} ist kein gueltiges Datum.`);
  }

  return date;
}

/** Formatiert ein Datum wie parseGermanDateTime() es erwartet, fuer Anzeigezwecke. */
export function formatGermanDateTime(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`
  );
}

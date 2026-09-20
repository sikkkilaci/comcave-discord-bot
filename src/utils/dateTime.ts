import { ValidationError } from './errors.js';

const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

interface DateComponents {
  day: number;
  month: number;
  year: number;
}

function parseDateComponents(datum: string): DateComponents {
  const dateMatch = DATE_PATTERN.exec(datum.trim());
  if (!dateMatch) {
    throw new ValidationError(
      'Datum muss im Format TT.MM.JJJJ (z. B. 24.12.2026) angegeben werden.',
    );
  }
  return { day: Number(dateMatch[1]), month: Number(dateMatch[2]), year: Number(dateMatch[3]) };
}

/**
 * Prueft, dass ein Datum tatsaechlich existiert (JS' `Date`-Konstruktor rollt
 * z. B. den 30. Februar sonst stillschweigend auf den 2. Maerz um) - wirft
 * andernfalls eine `ValidationError` statt ein falsches Datum zu speichern.
 */
function assertRealDate(date: Date, components: DateComponents, original: string): void {
  const isRealDate =
    date.getFullYear() === components.year &&
    date.getMonth() === components.month - 1 &&
    date.getDate() === components.day;

  if (!isRealDate) {
    throw new ValidationError(`${original} ist kein gueltiges Datum.`);
  }
}

/**
 * Parst Datum (`TT.MM.JJJJ`) und Uhrzeit (`HH:MM`) aus zwei getrennten
 * Slash-Command-Optionen zu einem einzelnen `Date`. Getrennt statt eines
 * kombinierten Feldes, weil das der in der Anforderung genannten Eingabeform
 * ("Datum und Uhrzeit") entspricht und in Discord-Slash-Commands zwei kurze
 * Textfelder komfortabler auszufuellen sind als ein langes.
 */
export function parseGermanDateTime(datum: string, uhrzeit: string): Date {
  const components = parseDateComponents(datum);
  const timeMatch = TIME_PATTERN.exec(uhrzeit.trim());

  if (!timeMatch) {
    throw new ValidationError('Uhrzeit muss im Format HH:MM (z. B. 14:30) angegeben werden.');
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    throw new ValidationError('Ungueltige Uhrzeit - Stunden muessen 00-23, Minuten 00-59 sein.');
  }

  const date = new Date(components.year, components.month - 1, components.day, hour, minute, 0, 0);
  assertRealDate(date, components, datum);
  return date;
}

/** Wie parseGermanDateTime(), aber nur ein Datum ohne Uhrzeit (Zeit wird auf 00:00 gesetzt). */
export function parseGermanDate(datum: string): Date {
  const components = parseDateComponents(datum);
  const date = new Date(components.year, components.month - 1, components.day, 0, 0, 0, 0);
  assertRealDate(date, components, datum);
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

/** Formatiert ein Datum wie parseGermanDate() es erwartet, fuer Anzeigezwecke (ohne Uhrzeit). */
export function formatGermanDate(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

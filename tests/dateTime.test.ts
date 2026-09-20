import { describe, expect, it } from 'vitest';
import {
  formatGermanDate,
  formatGermanDateTime,
  getIsoWeek,
  getIsoWeekYear,
  parseGermanDate,
  parseGermanDateTime,
  parseIsoDateOnly,
  toDateOnlyUtc,
} from '../src/utils/dateTime.js';
import { ValidationError } from '../src/utils/errors.js';

describe('parseGermanDateTime', () => {
  it('parst ein gueltiges Datum und eine gueltige Uhrzeit', () => {
    const date = parseGermanDateTime('24.12.2026', '14:30');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(11);
    expect(date.getDate()).toBe(24);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);
  });

  it('akzeptiert umgebende Leerzeichen', () => {
    const date = parseGermanDateTime(' 01.01.2027 ', ' 09:00 ');
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(9);
  });

  it('lehnt ein falsch formatiertes Datum ab', () => {
    expect(() => parseGermanDateTime('2026-12-24', '14:30')).toThrow(ValidationError);
  });

  it('lehnt eine falsch formatierte Uhrzeit ab', () => {
    expect(() => parseGermanDateTime('24.12.2026', '2:30 pm')).toThrow(ValidationError);
  });

  it('lehnt ein nicht existierendes Datum ab (z. B. 30. Februar)', () => {
    expect(() => parseGermanDateTime('30.02.2026', '10:00')).toThrow(ValidationError);
  });

  it('lehnt eine ungueltige Uhrzeit ab (Stunden > 23)', () => {
    expect(() => parseGermanDateTime('01.01.2027', '25:00')).toThrow(ValidationError);
  });

  it('lehnt eine ungueltige Uhrzeit ab (Minuten > 59)', () => {
    expect(() => parseGermanDateTime('01.01.2027', '10:75')).toThrow(ValidationError);
  });
});

describe('formatGermanDateTime', () => {
  it('formatiert ein Datum lesbar mit fuehrenden Nullen', () => {
    const formatted = formatGermanDateTime(new Date(2026, 0, 5, 9, 5));
    expect(formatted).toBe('05.01.2026 09:05 Uhr');
  });
});

describe('parseGermanDate', () => {
  it('parst ein gueltiges Datum ohne Uhrzeit (Zeit auf 00:00)', () => {
    const date = parseGermanDate('15.09.2026');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('lehnt ein falsch formatiertes Datum ab', () => {
    expect(() => parseGermanDate('2026-09-15')).toThrow(ValidationError);
  });

  it('lehnt ein nicht existierendes Datum ab (z. B. 31. April)', () => {
    expect(() => parseGermanDate('31.04.2026')).toThrow(ValidationError);
  });
});

describe('formatGermanDate', () => {
  it('formatiert ein Datum lesbar mit fuehrenden Nullen, ohne Uhrzeit', () => {
    const formatted = formatGermanDate(new Date(2026, 0, 5));
    expect(formatted).toBe('05.01.2026');
  });
});

describe('parseIsoDateOnly', () => {
  it('parst ein gueltiges ISO-Datum zu UTC-Mitternacht', () => {
    const date = parseIsoDateOnly('2026-08-17');
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(7);
    expect(date.getUTCDate()).toBe(17);
    expect(date.getUTCHours()).toBe(0);
  });

  it('lehnt ein falsch formatiertes Datum ab', () => {
    expect(() => parseIsoDateOnly('17.08.2026')).toThrow(ValidationError);
  });

  it('lehnt ein nicht existierendes Datum ab', () => {
    expect(() => parseIsoDateOnly('2026-02-30')).toThrow(ValidationError);
  });
});

describe('toDateOnlyUtc', () => {
  it('normalisiert ein Datum mit Uhrzeit auf UTC-Mitternacht desselben Kalendertags', () => {
    const normalized = toDateOnlyUtc(new Date(2026, 8, 20, 15, 42));
    expect(normalized.getUTCFullYear()).toBe(2026);
    expect(normalized.getUTCMonth()).toBe(8);
    expect(normalized.getUTCDate()).toBe(20);
    expect(normalized.getUTCHours()).toBe(0);
    expect(normalized.getUTCMinutes()).toBe(0);
  });
});

describe('getIsoWeek / getIsoWeekYear', () => {
  it('berechnet KW 34/2026 fuer den 17.08.2026 (Ausbildungsbeginn laut Kursplan-Quelle)', () => {
    const date = parseIsoDateOnly('2026-08-17');
    expect(getIsoWeek(date)).toBe(34);
    expect(getIsoWeekYear(date)).toBe(2026);
  });

  it('berechnet KW 1/2024 fuer den 01.01.2024 (Montag)', () => {
    const date = parseIsoDateOnly('2024-01-01');
    expect(getIsoWeek(date)).toBe(1);
    expect(getIsoWeekYear(date)).toBe(2024);
  });

  it('ordnet den 01.01.2023 (Sonntag) korrekt KW 52/2022 zu (Jahresgrenze)', () => {
    const date = parseIsoDateOnly('2023-01-01');
    expect(getIsoWeek(date)).toBe(52);
    expect(getIsoWeekYear(date)).toBe(2022);
  });

  it('erkennt KW 53 fuer den 31.12.2020 (Schaltjahr mit 53 ISO-Wochen)', () => {
    const date = parseIsoDateOnly('2020-12-31');
    expect(getIsoWeek(date)).toBe(53);
    expect(getIsoWeekYear(date)).toBe(2020);
  });
});

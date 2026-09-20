import { describe, expect, it } from 'vitest';
import { formatGermanDateTime, parseGermanDateTime } from '../src/utils/dateTime.js';
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

import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { listCourseContentByCourseNumber } from '../src/repositories/courseContentRepository.js';
import {
  DEFAULT_COURSE_CONTENT_SOURCE_FILE,
  importCourseContentAsAdmin,
  importCourseContentFromFile,
  loadCourseSchedule,
  parseCourseContentSource,
  parseCourseSchedule,
  reconstructCourseContentHierarchy,
} from '../src/services/courseContentImportService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: { id: string; isAdministrator?: boolean }): GuildMember {
  return {
    id: options.id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

async function writeTempSource(payload: unknown): Promise<{
  relativePath: string;
  cleanup: () => Promise<void>;
}> {
  const relativePath = `data/course-plans/.tmp-test-${randomUUID()}.json`;
  const absolutePath = path.join(process.cwd(), relativePath);
  await writeFile(absolutePath, JSON.stringify(payload), 'utf-8');
  return { relativePath, cleanup: () => unlink(absolutePath) };
}

describe('reconstructCourseContentHierarchy', () => {
  it('rekonstruiert eine dreistufige Hierarchie aus je-Ebene-neu-beginnender Nummerierung', () => {
    const result = reconstructCourseContentHierarchy([
      '1. Kurstitel',
      '1. Erstes Kapitel',
      '1. Erster Unterpunkt',
      '2. Zweiter Unterpunkt',
      '2. Zweites Kapitel',
      '1. Unterpunkt im zweiten Kapitel',
    ]);

    expect(result).toEqual([
      { orderIndex: 0, numberPath: '1', level: 1, text: 'Kurstitel' },
      { orderIndex: 1, numberPath: '1.1', level: 2, text: 'Erstes Kapitel' },
      { orderIndex: 2, numberPath: '1.1.1', level: 3, text: 'Erster Unterpunkt' },
      { orderIndex: 3, numberPath: '1.1.2', level: 3, text: 'Zweiter Unterpunkt' },
      { orderIndex: 4, numberPath: '1.2', level: 2, text: 'Zweites Kapitel' },
      { orderIndex: 5, numberPath: '1.2.1', level: 3, text: 'Unterpunkt im zweiten Kapitel' },
    ]);
  });

  it('liefert ein leeres Ergebnis fuer eine leere Eingabe (keine kuenstliche Auffuellung)', () => {
    expect(reconstructCourseContentHierarchy([])).toEqual([]);
  });

  it('wirft ValidationError bei einer Zeile ohne fuehrende Nummerierung', () => {
    expect(() => reconstructCourseContentHierarchy(['Kein Nummernpraefix'])).toThrow(
      ValidationError,
    );
  });

  it('wirft ValidationError, wenn eine Zahl sich in keine Ebene einordnen laesst', () => {
    // "3." als allererster Eintrag kann weder eine bestehende Ebene fortsetzen
    // (es gibt noch keine) noch (nur bei 1 gueltig) eine neue Ebene eroeffnen.
    expect(() => reconstructCourseContentHierarchy(['3. Ungueltiger Start'])).toThrow(
      ValidationError,
    );
  });
});

describe('parseCourseContentSource', () => {
  it('parst gueltige Kurse inkl. rekonstruierter Hierarchie', () => {
    const result = parseCourseContentSource(
      JSON.stringify({
        courses: [
          { courseId: 'a', title: 'Kurs A', contentItems: ['1. Kurs A', '1. Unterpunkt'] },
          { courseId: 'b', title: 'Kurs B', contentItems: [] },
        ],
      }),
    );

    expect(result).toEqual([
      {
        courseNumber: 'a',
        courseTitle: 'Kurs A',
        items: [
          { orderIndex: 0, numberPath: '1', level: 1, text: 'Kurs A' },
          { orderIndex: 1, numberPath: '1.1', level: 2, text: 'Unterpunkt' },
        ],
      },
      { courseNumber: 'b', courseTitle: 'Kurs B', items: [] },
    ]);
  });

  it('wirft ValidationError bei ungueltigem JSON', () => {
    expect(() => parseCourseContentSource('{ das ist kein json')).toThrow(ValidationError);
  });

  it('wirft ValidationError bei fehlenden Pflichtfeldern', () => {
    expect(() =>
      parseCourseContentSource(JSON.stringify({ courses: [{ courseId: 'a' }] })),
    ).toThrow(ValidationError);
  });

  it('wirft ValidationError bei doppelten courseId-Werten', () => {
    const source = {
      courses: [
        { courseId: 'dup', title: 'Kurs A', contentItems: [] },
        { courseId: 'dup', title: 'Kurs B', contentItems: [] },
      ],
    };

    expect(() => parseCourseContentSource(JSON.stringify(source))).toThrow(ValidationError);
  });
});

describe('parseCourseSchedule', () => {
  it('parst Kursnummer/-titel und Start-/Enddatum aus der Quelldatei, ohne die DB zu beruehren', () => {
    const result = parseCourseSchedule(
      JSON.stringify({
        courses: [
          { courseId: 'a', title: 'Kurs A', start: '17.08.2026', end: '27.08.2026' },
          { courseId: 'b', title: 'Kurs B', start: '28.08.2026', end: '04.09.2026' },
        ],
      }),
    );

    expect(result).toEqual([
      {
        courseNumber: 'a',
        courseTitle: 'Kurs A',
        start: new Date(2026, 7, 17),
        end: new Date(2026, 7, 27),
      },
      {
        courseNumber: 'b',
        courseTitle: 'Kurs B',
        start: new Date(2026, 7, 28),
        end: new Date(2026, 8, 4),
      },
    ]);
  });

  it('wirft ValidationError bei ungueltigem JSON', () => {
    expect(() => parseCourseSchedule('{ das ist kein json')).toThrow(ValidationError);
  });

  it('wirft ValidationError bei fehlenden Pflichtfeldern', () => {
    expect(() =>
      parseCourseSchedule(JSON.stringify({ courses: [{ courseId: 'a', title: 'Kurs A' }] })),
    ).toThrow(ValidationError);
  });

  it('wirft eine kursbezogene ValidationError bei einem ungueltigen Datum', () => {
    expect(() =>
      parseCourseSchedule(
        JSON.stringify({
          courses: [{ courseId: 'a', title: 'Kurs A', start: '31.02.2026', end: '01.03.2026' }],
        }),
      ),
    ).toThrow(/Kurs "a" \(Kurs A\)/);
  });
});

describe('loadCourseSchedule - reale Kursinhalte-Quelldatei', () => {
  it('liest alle 34 Kurse mit Start-/Enddatum, sortierbar unabhaengig von der DB', async () => {
    const schedule = await loadCourseSchedule(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    expect(schedule).toHaveLength(34);
    const entry = schedule.find((course) => course.courseNumber === '567472');
    expect(entry).toMatchObject({ courseTitle: 'Allgemeine Betriebswirtschaftslehre' });
    expect(entry?.start).toEqual(new Date(2026, 8, 21));
    expect(entry?.end).toEqual(new Date(2026, 9, 6));
  });

  it('wirft eine verstaendliche ValidationError, wenn die Quelldatei nicht existiert', async () => {
    await expect(
      loadCourseSchedule(`data/course-plans/.does-not-exist-${randomUUID()}.json`),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('importCourseContentFromFile - reale Kursinhalte-Quelldatei', () => {
  it('importiert alle 34 Kurse und genau 592 Inhaltseintraege', async () => {
    const summary = await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    expect(summary.coursesProcessed).toBe(34);
    expect(summary.itemsCreated + summary.itemsUpdated).toBe(592);
  });

  it('ist idempotent: ein zweiter Import erzeugt keine neuen Eintraege', async () => {
    await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);
    const second = await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    expect(second.coursesProcessed).toBe(34);
    expect(second.itemsCreated).toBe(0);
    expect(second.itemsUpdated).toBe(592);
    expect(second.itemsDeleted).toBe(0);
  });

  it('ordnet Inhalte korrekt der jeweiligen Kursnummer/courseId zu und erhaelt die Hierarchie', async () => {
    await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    const items = await listCourseContentByCourseNumber('567472');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.courseTitle === 'Allgemeine Betriebswirtschaftslehre')).toBe(
      true,
    );
    expect(items[0]).toMatchObject({
      orderIndex: 0,
      numberPath: '1',
      level: 1,
      text: 'Allgemeine Betriebswirtschaftslehre',
    });
    const klausur = items.find((item) => item.text === 'Klausur');
    expect(klausur).toMatchObject({ numberPath: '1.6', level: 2 });

    // Kurs ohne Inhalte in der Quelle bleibt konsequent ohne Eintraege.
    const empty = await listCourseContentByCourseNumber('567470');
    expect(empty).toHaveLength(0);
  });

  it('behandelt einen Pruefungsvorbereitungskurs wie jeden anderen Kurs mit Inhalten', async () => {
    await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    const items = await listCourseContentByCourseNumber('567564');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.courseTitle).toBe(
      'Vorbereitung schriftliche Prüfung Teil 1: Einrichten eines IT-gestütztenArbeitsplatzes',
    );
  });

  it('haelt die Anzahl der Kursinhalte pro Kurs exakt konsistent mit der Quelle', async () => {
    await importCourseContentFromFile(DEFAULT_COURSE_CONTENT_SOURCE_FILE);

    const raw = JSON.parse(
      await readFile(path.join(process.cwd(), DEFAULT_COURSE_CONTENT_SOURCE_FILE), 'utf-8'),
    ) as { courses: Array<{ courseId: string; contentItems: string[] }> };

    for (const course of raw.courses) {
      const items = await listCourseContentByCourseNumber(course.courseId);
      expect(items).toHaveLength(course.contentItems.length);
    }
  });

  it('wirft eine verstaendliche ValidationError, wenn die Quelldatei nicht existiert', async () => {
    await expect(
      importCourseContentFromFile(`data/course-plans/.does-not-exist-${randomUUID()}.json`),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('uebernimmt eine geaenderte Quelle kontrolliert (aktualisiert und entfernt statt zu duplizieren)', async () => {
    const courseId = `course-${randomUUID()}`;
    const first = await writeTempSource({
      courses: [
        {
          courseId,
          title: 'Testkurs',
          contentItems: ['1. Testkurs', '1. Wird entfernt', '2. Bleibt bestehen'],
        },
      ],
    });
    await importCourseContentFromFile(first.relativePath);
    await first.cleanup();

    const second = await writeTempSource({
      courses: [{ courseId, title: 'Testkurs', contentItems: ['1. Testkurs geaendert'] }],
    });

    try {
      const summary = await importCourseContentFromFile(second.relativePath);
      expect(summary.itemsUpdated).toBe(1);
      expect(summary.itemsDeleted).toBe(2);

      const items = await listCourseContentByCourseNumber(courseId);
      expect(items).toHaveLength(1);
      expect(items[0]?.text).toBe('Testkurs geaendert');
    } finally {
      await second.cleanup();
    }
  });
});

describe('importCourseContentAsAdmin - Berechtigung', () => {
  it('ein globaler Admin kann den Kursinhalte-Import ausloesen und es wird ein Audit-Log-Eintrag geschrieben', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const summary = await importCourseContentAsAdmin(guildConfig, admin, admin.id);
    expect(summary.coursesProcessed).toBe(34);

    const entries = await listAuditEvents(guildId, { actorDiscordId: admin.id });
    expect(entries.some((entry) => entry.action === 'courseContent.import')).toBe(true);
  });

  it('ein normales Mitglied darf den Kursinhalte-Import nicht ausloesen', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const member = fakeMember({ id: 'member-1' });

    await expect(importCourseContentAsAdmin(guildConfig, member, member.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});

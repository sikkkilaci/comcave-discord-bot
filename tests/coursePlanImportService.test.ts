import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateClass, getClassByName } from '../src/repositories/classRepository.js';
import {
  listCourseEntriesByClassId,
  listCourseSpecialDaysByClassId,
} from '../src/repositories/coursePlanRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  COURSE_PLAN_SOURCE_FILES,
  importCoursePlanForClass,
  importCoursePlanFromFile,
  parseCoursePlanHtml,
} from '../src/services/coursePlanImportService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: {
  id: string;
  ownerId?: string;
  isAdministrator?: boolean;
}): GuildMember {
  return {
    id: options.id,
    guild: { ownerId: options.ownerId ?? 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

const SOURCE_FILE_A = COURSE_PLAN_SOURCE_FILES.A;
if (!SOURCE_FILE_A) {
  throw new Error('Testvoraussetzung verletzt: COURSE_PLAN_SOURCE_FILES.A ist nicht gesetzt.');
}

function minimalValidHtml(): string {
  return `<script>
const courses = [
 {id:"1",name:"Testkurs",start:"2026-01-05",end:"2026-01-09",trainer:"Frau Test"}
];
const special = [
 {start:"2026-01-01",end:"2026-01-01",label:"Test-Feiertag"}
];
</script>`;
}

describe('parseCoursePlanHtml', () => {
  it('parst alle 18 Kurse und 3 besonderen Termine aus der echten Klasse-A-Quelldatei', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const html = await readFile(path.join(process.cwd(), SOURCE_FILE_A), 'utf-8');

    const parsed = parseCoursePlanHtml(html);

    expect(parsed.courses).toHaveLength(18);
    expect(parsed.specialDays).toHaveLength(3);
    expect(parsed.courses[0]).toMatchObject({
      courseNumber: '567469',
      title: 'Einführung fachbezogenes Rechnen / Digitaltechnik',
      trainer: 'Herr Wolfgang Brach',
    });
    expect(parsed.courses[0]?.startDate.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(parsed.courses[0]?.endDate.toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('wandelt einen leeren Trainer-String in null um', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const html = await readFile(path.join(process.cwd(), SOURCE_FILE_A), 'utf-8');

    const parsed = parseCoursePlanHtml(html);

    const withoutTrainer = parsed.courses.find((c) => c.courseNumber === '571301');
    expect(withoutTrainer?.trainer).toBeNull();
  });

  it('erfindet keine zusaetzlichen Kurse oder Felder', () => {
    const parsed = parseCoursePlanHtml(minimalValidHtml());

    expect(parsed.courses).toEqual([
      {
        courseNumber: '1',
        title: 'Testkurs',
        trainer: 'Frau Test',
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-09T00:00:00.000Z'),
      },
    ]);
    expect(parsed.specialDays).toEqual([
      {
        label: 'Test-Feiertag',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('lehnt eine Quelle ohne "courses"-Array ab, statt leere Daten zu importieren', () => {
    expect(() => parseCoursePlanHtml('<script>const special = [];</script>')).toThrow(
      ValidationError,
    );
  });

  it('lehnt eine strukturell unvollstaendige Quelle ab (Format-Abweichung), statt Teildaten zu uebernehmen', () => {
    const broken = `<script>
const courses = [
 {id:"1",name:"Testkurs",start:"2026-01-05",end:"2026-01-09",trainer:"Frau Test"},
 {id:"2", malformedEntryWithoutRequiredFields: true}
];
const special = [];
</script>`;

    expect(() => parseCoursePlanHtml(broken)).toThrow(ValidationError);
  });
});

describe('importCoursePlanFromFile - Idempotenz', () => {
  it('importiert alle Kurse/besonderen Termine der Klasse-A-Quelle', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const klasse = await getOrCreateClass(guildId, 'A');

    const summary = await importCoursePlanFromFile(guildId, klasse.id, SOURCE_FILE_A, 'admin-1');

    expect(summary.coursesCreated).toBe(18);
    expect(summary.coursesUpdated).toBe(0);
    expect(summary.specialDaysCreated).toBe(3);
    expect(summary.specialDaysUpdated).toBe(0);

    const entries = await listCourseEntriesByClassId(klasse.id);
    const specialDays = await listCourseSpecialDaysByClassId(klasse.id);
    expect(entries).toHaveLength(18);
    expect(specialDays).toHaveLength(3);
  });

  it('erzeugt bei einem wiederholten Import keine Duplikate (idempotent)', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const klasse = await getOrCreateClass(guildId, 'A');

    await importCoursePlanFromFile(guildId, klasse.id, SOURCE_FILE_A, 'admin-1');
    const secondRun = await importCoursePlanFromFile(guildId, klasse.id, SOURCE_FILE_A, 'admin-1');

    expect(secondRun.coursesCreated).toBe(0);
    expect(secondRun.coursesUpdated).toBe(18);
    expect(secondRun.specialDaysCreated).toBe(0);
    expect(secondRun.specialDaysUpdated).toBe(3);

    const entries = await listCourseEntriesByClassId(klasse.id);
    const specialDays = await listCourseSpecialDaysByClassId(klasse.id);
    expect(entries).toHaveLength(18);
    expect(specialDays).toHaveLength(3);
  });

  it('uebernimmt eine geaenderte Quelle kontrolliert (aktualisiert bestehenden Slot statt Duplikat)', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const klasse = await getOrCreateClass(guildId, 'A');

    await importCoursePlanFromFile(guildId, klasse.id, SOURCE_FILE_A, 'admin-1');

    // Simuliert eine spaetere Quelldatei-Aenderung: derselbe Kurs-Slot (Klasse
    // + Kursnummer + Start), aber ein anderer Titel/Dozent.
    const path = await import('node:path');
    const fsExtra = await import('node:fs/promises');
    const originalPath = path.join(process.cwd(), SOURCE_FILE_A);
    const html = await fsExtra.readFile(originalPath, 'utf-8');
    const changedHtml = html.replace(
      '{id:"567469",name:"Einführung fachbezogenes Rechnen / Digitaltechnik",start:"2026-08-17",end:"2026-08-25",trainer:"Herr Wolfgang Brach"}',
      '{id:"567469",name:"Geaenderter Titel",start:"2026-08-17",end:"2026-08-25",trainer:"Frau Neu"}',
    );
    const tmpPath = `data/course-plans/.tmp-test-${randomUUID()}.html`;
    const absoluteTmpPath = path.join(process.cwd(), tmpPath);
    await fsExtra.writeFile(absoluteTmpPath, changedHtml, 'utf-8');

    try {
      const summary = await importCoursePlanFromFile(guildId, klasse.id, tmpPath, 'admin-1');
      expect(summary.coursesUpdated).toBe(18);

      const entries = await listCourseEntriesByClassId(klasse.id);
      const changed = entries.find((e) => e.courseNumber === '567469' && e.trainer === 'Frau Neu');
      expect(changed?.title).toBe('Geaenderter Titel');
      expect(entries).toHaveLength(18); // keine Duplikate durch die Aktualisierung
    } finally {
      await fsExtra.unlink(absoluteTmpPath);
    }
  });
});

describe('importCoursePlanForClass - Berechtigung', () => {
  it('ein globaler Admin kann Kursplandaten fuer Klasse A importieren', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const result = await importCoursePlanForClass(guildConfig, admin, 'A', admin.id);

    expect(result.className).toBe('A');
    expect(result.coursesCreated).toBe(18);
  });

  it('ein normales Mitglied darf keine Kursplandaten importieren', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const member = fakeMember({ id: 'member-1' });

    await expect(
      importCoursePlanForClass(guildConfig, member, 'A', member.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('eine Klassenleitung darf ohne globale Admin-Rechte keine Kursplandaten importieren', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const classLead = fakeMember({ id: 'lead-a' });

    await expect(
      importCoursePlanForClass(guildConfig, classLead, 'A', classLead.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('lehnt den Import fuer Klasse B ab, da noch keine Quelldatei hinterlegt ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await expect(
      importCoursePlanForClass(guildConfig, admin, 'B', admin.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('schreibt einen "coursePlan.import"-Audit-Log-Eintrag', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await importCoursePlanForClass(guildConfig, admin, 'A', admin.id);

    const entries = await listAuditEvents(guildId);
    const entry = entries.find((e) => e.action === 'coursePlan.import');
    expect(entry).toBeDefined();
    expect(JSON.parse(entry?.metadata ?? '{}')).toMatchObject({
      className: 'A',
      coursesCreated: 18,
    });
  });

  it('legt die Klasse A bei Bedarf automatisch an', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    expect(await getClassByName(guildId, 'A')).toBeNull();

    await importCoursePlanForClass(guildConfig, admin, 'A', admin.id);

    expect(await getClassByName(guildId, 'A')).not.toBeNull();
  });
});

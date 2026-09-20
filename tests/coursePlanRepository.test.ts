import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateClass } from '../src/repositories/classRepository.js';
import {
  acknowledgeCourseEntry,
  listAcknowledgmentsForCourseEntry,
  upsertCourseEntry,
} from '../src/repositories/coursePlanRepository.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

describe('coursePlanRepository', () => {
  describe('acknowledgeCourseEntry', () => {
    it(
      'erzeugt bei zwei gleichzeitigen Aufrufen (Race Condition, z. B. Doppelklick) nur eine ' +
        'Kenntnisnahme statt eines Fehlers',
      async () => {
        const guildId = uniqueGuildId();
        await getOrCreateGuildConfig(guildId);
        const klasse = await getOrCreateClass(guildId, 'A');
        const { entry } = await upsertCourseEntry({
          guildId,
          classId: klasse.id,
          courseNumber: 'C-RACE',
          title: 'Race-Test-Kurs',
          trainer: null,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-10T00:00:00.000Z'),
          sourceFile: 'test',
          createdByDiscordId: 'admin-1',
        });

        const input = {
          guildId,
          classId: klasse.id,
          courseEntryId: entry.id,
          memberDiscordId: 'member-1',
        };

        const [first, second] = await Promise.all([
          acknowledgeCourseEntry(input),
          acknowledgeCourseEntry(input),
        ]);

        expect([first.created, second.created].sort()).toEqual([false, true]);
        expect(first.acknowledgment.id).toBe(second.acknowledgment.id);

        const stored = await listAcknowledgmentsForCourseEntry(entry.id);
        expect(stored).toHaveLength(1);
      },
    );
  });
});

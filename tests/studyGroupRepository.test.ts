import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateClass } from '../src/repositories/classRepository.js';
import {
  addStudyGroupMember,
  createStudyGroup,
  listStudyGroupMembers,
} from '../src/repositories/studyGroupRepository.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

describe('studyGroupRepository', () => {
  describe('addStudyGroupMember', () => {
    it(
      'erzeugt bei zwei gleichzeitigen Beitrittsversuchen (Race Condition, z. B. Doppelklick) ' +
        'nur eine Mitgliedschaft statt eines Fehlers',
      async () => {
        const guildId = uniqueGuildId();
        await getOrCreateGuildConfig(guildId);
        const klasse = await getOrCreateClass(guildId, 'A');
        const group = await createStudyGroup({
          guildId,
          classId: klasse.id,
          name: 'Race-Test-Gruppe',
          createdByDiscordId: 'creator-1',
          maxParticipants: null,
        });

        const input = {
          guildId,
          classId: klasse.id,
          studyGroupId: group.id,
          memberDiscordId: 'member-1',
        };

        const [first, second] = await Promise.all([
          addStudyGroupMember(input),
          addStudyGroupMember(input),
        ]);

        expect([first.created, second.created].sort()).toEqual([false, true]);
        expect(first.membership.id).toBe(second.membership.id);

        const members = await listStudyGroupMembers(group.id);
        expect(members).toHaveLength(1);
      },
    );
  });
});

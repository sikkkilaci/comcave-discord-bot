import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { createNewActiveRuleSet } from '../src/repositories/ruleSetRepository.js';
import {
  acceptRules,
  listAcceptancesForRuleSet,
} from '../src/repositories/ruleAcceptanceRepository.js';

describe('ruleAcceptanceRepository', () => {
  describe('acceptRules', () => {
    it(
      'erzeugt bei zwei gleichzeitigen Zustimmungsversuchen (Race Condition, z. B. Doppelklick) ' +
        'nur eine Zustimmung statt eines Fehlers',
      async () => {
        const guildId = `guild-${randomUUID()}`;
        await getOrCreateGuildConfig(guildId);
        const ruleSet = await createNewActiveRuleSet(guildId, 'Regeltext', 'admin-1');
        const memberDiscordId = 'member-1';

        const [first, second] = await Promise.all([
          acceptRules(guildId, memberDiscordId, ruleSet.id),
          acceptRules(guildId, memberDiscordId, ruleSet.id),
        ]);

        expect([first.created, second.created].sort()).toEqual([false, true]);
        expect(first.acceptance.id).toBe(second.acceptance.id);

        const stored = await listAcceptancesForRuleSet(ruleSet.id);
        expect(stored).toHaveLength(1);
      },
    );
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getMember,
  getOrCreateMember,
  setVerificationStatus,
} from '../src/repositories/memberRepository.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

describe('memberRepository', () => {
  describe('getOrCreateMember', () => {
    it('legt einen neuen Member mit Status PENDING an', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const member = await getOrCreateMember(guildId, 'discord-user-1');

      expect(member.guildId).toBe(guildId);
      expect(member.discordId).toBe('discord-user-1');
      expect(member.verificationStatus).toBe('PENDING');
      expect(member.verifiedAt).toBeNull();
    });

    it('ist idempotent und legt bei wiederholtem Aufruf keinen zweiten Datensatz an', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const first = await getOrCreateMember(guildId, 'discord-user-1');
      const second = await getOrCreateMember(guildId, 'discord-user-1');

      expect(second.id).toBe(first.id);
    });

    it('unterscheidet Mitglieder mit gleicher Discord-ID auf unterschiedlichen Servern', async () => {
      const guildA = uniqueGuildId();
      const guildB = uniqueGuildId();
      await getOrCreateGuildConfig(guildA);
      await getOrCreateGuildConfig(guildB);

      const memberA = await getOrCreateMember(guildA, 'discord-user-shared');
      const memberB = await getOrCreateMember(guildB, 'discord-user-shared');

      expect(memberA.id).not.toBe(memberB.id);
    });
  });

  describe('getMember', () => {
    it('gibt null zurueck, wenn kein Datensatz existiert', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const member = await getMember(guildId, 'unbekannter-nutzer');

      expect(member).toBeNull();
    });

    it('findet einen zuvor angelegten Datensatz', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await getOrCreateMember(guildId, 'discord-user-1');

      const member = await getMember(guildId, 'discord-user-1');

      expect(member?.discordId).toBe('discord-user-1');
    });
  });

  describe('setVerificationStatus', () => {
    it('setzt verifiedAt beim Wechsel zu VERIFIED', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const updated = await setVerificationStatus(guildId, 'discord-user-1', 'VERIFIED');

      expect(updated.verificationStatus).toBe('VERIFIED');
      expect(updated.verifiedAt).not.toBeNull();
    });

    it('legt das Mitglied bei Bedarf automatisch an (ohne vorherigen getOrCreateMember-Aufruf)', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const updated = await setVerificationStatus(guildId, 'discord-user-neu', 'REJECTED');

      expect(updated.discordId).toBe('discord-user-neu');
      expect(updated.verificationStatus).toBe('REJECTED');
    });

    it('setzt verifiedAt zurueck, wenn der Status von VERIFIED auf PENDING wechselt', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await setVerificationStatus(guildId, 'discord-user-1', 'VERIFIED');

      const updated = await setVerificationStatus(guildId, 'discord-user-1', 'PENDING');

      expect(updated.verificationStatus).toBe('PENDING');
      expect(updated.verifiedAt).toBeNull();
    });
  });
});

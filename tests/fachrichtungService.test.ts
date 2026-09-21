import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getMember,
  setVerificationStatus,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  assertFachrichtungChosen,
  chooseFachrichtung,
} from '../src/services/fachrichtungService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function uniqueIds(): { guildId: string; discordId: string } {
  return { guildId: `guild-${randomUUID()}`, discordId: `discord-${randomUUID()}` };
}

/** Verifiziert + Profil vollstaendig - der "startklar fuer Fachrichtungswahl"-Zustand. */
async function createReadyMember(): Promise<{ guildId: string; discordId: string }> {
  const { guildId, discordId } = uniqueIds();
  await getOrCreateGuildConfig(guildId);
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
  return { guildId, discordId };
}

describe('fachrichtungService', () => {
  describe('chooseFachrichtung - Berechtigungspruefung', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);

      await expect(
        chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('wirft PermissionError, wenn das Profil trotz Verifizierung nicht vollstaendig ist', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);
      await setVerificationStatus(guildId, discordId, 'VERIFIED');

      await expect(
        chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('chooseFachrichtung - Erstwahl', () => {
    it('speichert die Fachrichtung und schreibt einen Audit-Log-Eintrag', async () => {
      const { guildId, discordId } = await createReadyMember();

      const result = await chooseFachrichtung(
        guildId,
        discordId,
        'ANWENDUNGSENTWICKLUNG',
        discordId,
      );

      expect(result.changed).toBe(true);
      expect(result.fachrichtung).toBe('ANWENDUNGSENTWICKLUNG');

      const member = await getMember(guildId, discordId);
      expect(member?.fachrichtung).toBe('ANWENDUNGSENTWICKLUNG');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(auditEntries.some((e) => e.action === 'member.fachrichtung_set')).toBe(true);
    });

    it('ist idempotent: ein erneuter Klick auf dieselbe Fachrichtung aendert nichts', async () => {
      const { guildId, discordId } = await createReadyMember();
      await chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId);

      const second = await chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId);

      expect(second.changed).toBe(false);
    });
  });

  describe('chooseFachrichtung - Einmal-Sperre', () => {
    it(
      'wirft ValidationError, wenn ein Mitglied eine ANDERE Fachrichtung waehlt, nachdem bereits ' +
        'eine gesetzt ist (kein Selbst-Wechsel)',
      async () => {
        const { guildId, discordId } = await createReadyMember();
        await chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId);

        await expect(
          chooseFachrichtung(guildId, discordId, 'ANWENDUNGSENTWICKLUNG', discordId),
        ).rejects.toBeInstanceOf(ValidationError);

        // Die urspruengliche Wahl darf durch den fehlgeschlagenen Versuch nicht veraendert worden sein.
        const member = await getMember(guildId, discordId);
        expect(member?.fachrichtung).toBe('SYSTEMINTEGRATION');
      },
    );
  });

  describe('assertFachrichtungChosen', () => {
    it('wirft PermissionError, wenn noch keine Fachrichtung gewaehlt wurde', async () => {
      const { guildId, discordId } = await createReadyMember();

      await expect(assertFachrichtungChosen(guildId, discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('gibt das Mitglied zurueck, wenn eine Fachrichtung gewaehlt wurde', async () => {
      const { guildId, discordId } = await createReadyMember();
      await chooseFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION', discordId);

      const member = await assertFachrichtungChosen(guildId, discordId);

      expect(member.fachrichtung).toBe('SYSTEMINTEGRATION');
    });
  });
});

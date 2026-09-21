import { randomUUID } from 'node:crypto';
import { DiscordAPIError, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { updateClassRole } from '../src/repositories/classRepository.js';
import {
  getMemberWithClass,
  setMemberFachrichtung,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { setVerificationStatus } from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { assignClass, getCurrentClassName } from '../src/services/classService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeGuildMember(
  discordId: string,
  initialRoleIds: string[] = [],
  options: { addImpl?: (roleId: string, reason?: string) => Promise<unknown> } = {},
): GuildMember {
  const roleIds = new Set(initialRoleIds);

  const add =
    options.addImpl ??
    (async (roleId: string) => {
      roleIds.add(roleId);
    });

  return {
    id: discordId,
    roles: {
      cache: { has: (roleId: string) => roleIds.has(roleId) },
      add: vi.fn(add),
      remove: vi.fn(async (roleId: string) => {
        roleIds.delete(roleId);
      }),
    },
  } as unknown as GuildMember;
}

async function setupGuildWithClasses(): Promise<{
  guildId: string;
  guildConfig: Awaited<ReturnType<typeof getOrCreateGuildConfig>>;
  roleA: string;
  roleB: string;
}> {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  const roleA = `role-a-${randomUUID()}`;
  const roleB = `role-b-${randomUUID()}`;
  await updateClassRole(guildId, 'A', roleA);
  await updateClassRole(guildId, 'B', roleB);
  return { guildId, guildConfig, roleA, roleB };
}

/** Markiert das Teilnehmerprofil als vollstaendig und legt eine Fachrichtung fest. */
async function completeProfileAndChooseFachrichtung(
  guildId: string,
  discordId: string,
): Promise<void> {
  await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
  await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
}

/** Verifiziert + Profil vollstaendig + Fachrichtung gewaehlt - der "startklar fuer Klassenwahl"-Zustand. */
async function createVerifiedDiscordId(guildId: string): Promise<string> {
  const discordId = `discord-${randomUUID()}`;
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  await completeProfileAndChooseFachrichtung(guildId, discordId);
  return discordId;
}

describe('classService', () => {
  describe('assignClass - Berechtigungspruefung', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const member = fakeGuildMember(`discord-${randomUUID()}`);

      await expect(assignClass(member, guildConfig, 'A', member.id)).rejects.toBeInstanceOf(
        PermissionError,
      );
      expect(guildId).toBeTruthy();
    });
  });

  describe('assignClass - ungueltige Klassenauswahl', () => {
    it('wirft ValidationError, wenn die Klasse noch keine Rolle konfiguriert hat', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);

      await expect(assignClass(member, guildConfig, 'C', member.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('assignClass - Erstzuweisung', () => {
    it('vergibt die Rolle, aktualisiert die DB und schreibt einen "class.assign"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig, roleA } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);

      const result = await assignClass(member, guildConfig, 'A', discordId);

      expect(result.changed).toBe(true);
      expect(result.previousClassName).toBeNull();
      expect(result.newClassName).toBe('A');
      expect(member.roles.add).toHaveBeenCalledWith(roleA, expect.any(String));
      expect(member.roles.remove).not.toHaveBeenCalled();

      const stored = await getMemberWithClass(guildId, discordId);
      expect(stored?.class?.name).toBe('A');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe('class.assign');
      expect(auditEntries[0]?.actorDiscordId).toBe(discordId);
      expect(JSON.parse(auditEntries[0]?.metadata ?? '{}')).toEqual({ from: null, to: 'A' });
    });

    it('ist idempotent: erneute Auswahl derselben Klasse aendert nichts', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);

      await assignClass(member, guildConfig, 'A', discordId);
      const second = await assignClass(member, guildConfig, 'A', discordId);

      expect(second.changed).toBe(false);
      expect(member.roles.add).toHaveBeenCalledTimes(1);

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(auditEntries).toHaveLength(1);
    });
  });

  describe('assignClass - Klassenwechsel (nur per Admin-Override, siehe Einmal-Sperre unten)', () => {
    it('entfernt die alte Rolle, vergibt die neue, aktualisiert die DB und schreibt "class.change"', async () => {
      const { guildId, guildConfig, roleA, roleB } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'A', discordId);

      const result = await assignClass(member, guildConfig, 'B', discordId, { allowChange: true });

      expect(result.changed).toBe(true);
      expect(result.previousClassName).toBe('A');
      expect(result.newClassName).toBe('B');
      expect(member.roles.remove).toHaveBeenCalledWith(roleA, expect.any(String));
      expect(member.roles.add).toHaveBeenCalledWith(roleB, expect.any(String));

      const stored = await getMemberWithClass(guildId, discordId);
      expect(stored?.class?.name).toBe('B');

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      const changeEntry = auditEntries.find((entry) => entry.action === 'class.change');
      expect(changeEntry).toBeDefined();
      expect(JSON.parse(changeEntry?.metadata ?? '{}')).toEqual({ from: 'A', to: 'B' });
    });

    it('ein Mitglied gehoert nach dem Wechsel nur noch der neuen Klasse an (keine doppelte Rolle)', async () => {
      const { guildId, guildConfig, roleA, roleB } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'A', discordId);

      await assignClass(member, guildConfig, 'B', discordId, { allowChange: true });

      expect(member.roles.cache.has(roleA)).toBe(false);
      expect(member.roles.cache.has(roleB)).toBe(true);
      const stored = await getMemberWithClass(guildId, discordId);
      expect(stored?.classId).not.toBeNull();
    });

    it('heilt eine Diskrepanz selbst: DB zeigt bereits die Zielklasse, aber die Rolle fehlt auf Discord', async () => {
      const { guildId, guildConfig, roleA } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const memberWithRole = fakeGuildMember(discordId);
      await assignClass(memberWithRole, guildConfig, 'A', discordId);

      // Rolle wurde z.B. manuell auf Discord entfernt, DB weiss davon nichts.
      const memberWithoutRole = fakeGuildMember(discordId, []);

      const result = await assignClass(memberWithoutRole, guildConfig, 'A', discordId);

      expect(result.changed).toBe(true);
      expect(memberWithoutRole.roles.add).toHaveBeenCalledWith(roleA, expect.any(String));

      const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(auditEntries.every((entry) => entry.action === 'class.assign')).toBe(true);
    });
  });

  describe('assignClass - Einmal-Sperre (Selbstbedienung)', () => {
    it('wirft PermissionError, wenn ein Mitglied seine bereits zugewiesene Klasse selbst wechseln will', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'A', discordId);

      await expect(assignClass(member, guildConfig, 'B', discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );

      // Sperre darf die Rolle/DB nicht veraendert haben.
      const stored = await getMemberWithClass(guildId, discordId);
      expect(stored?.class?.name).toBe('A');
    });

    it('erlaubt weiterhin einen erneuten Klick auf die BEREITS zugewiesene Klasse (kein Wechsel)', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'A', discordId);

      const result = await assignClass(member, guildConfig, 'A', discordId);

      expect(result.changed).toBe(false);
    });

    it('Admin-Override (allowChange: true) darf die Sperre umgehen', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'A', discordId);

      const result = await assignClass(member, guildConfig, 'B', discordId, {
        allowChange: true,
      });

      expect(result.changed).toBe(true);
      expect(result.newClassName).toBe('B');
    });
  });

  describe('assignClass - Discord-Fehlerbehandlung', () => {
    it('uebersetzt fehlende Bot-Berechtigungen (Discord-Fehlercode 50013) in eine verstaendliche ValidationError', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId, [], {
        addImpl: async () => {
          throw new DiscordAPIError(
            { code: 50013, message: 'Missing Permissions' },
            50013,
            403,
            'PUT',
            '/guilds/x/members/y/roles/z',
            { body: undefined, files: undefined },
          );
        },
      });

      await expect(assignClass(member, guildConfig, 'A', discordId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('reicht unbekannte Fehler beim Rollenzugriff unveraendert weiter', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId, [], {
        addImpl: async () => {
          throw new Error('Netzwerkfehler');
        },
      });

      await expect(assignClass(member, guildConfig, 'A', discordId)).rejects.toThrow(
        'Netzwerkfehler',
      );
    });
  });

  describe('getCurrentClassName', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);
      const discordId = `discord-${randomUUID()}`;

      await expect(getCurrentClassName(guildId, discordId)).rejects.toBeInstanceOf(PermissionError);
    });

    it('gibt null zurueck, wenn noch keine Klasse zugewiesen ist', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);
      const discordId = await createVerifiedDiscordId(guildId);

      const className = await getCurrentClassName(guildId, discordId);

      expect(className).toBeNull();
    });

    it('gibt die aktuelle Klasse zurueck und ist bei wiederholtem Aufruf ("erneutes #wo-bin-ich") stabil', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = await createVerifiedDiscordId(guildId);
      const member = fakeGuildMember(discordId);
      await assignClass(member, guildConfig, 'B', discordId);

      const firstCall = await getCurrentClassName(guildId, discordId);
      const secondCall = await getCurrentClassName(guildId, discordId);

      expect(firstCall).toBe('B');
      expect(secondCall).toBe('B');
    });
  });

  describe('Profil-/Fachrichtung-Guard (Umgehungsschutz)', () => {
    it('assignClass wirft PermissionError, wenn das Profil trotz Verifizierung nicht vollstaendig ist', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = `discord-${randomUUID()}`;
      await setVerificationStatus(guildId, discordId, 'VERIFIED');
      const member = fakeGuildMember(discordId);

      await expect(assignClass(member, guildConfig, 'A', discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('getCurrentClassName wirft PermissionError, wenn das Profil trotz Verifizierung nicht vollstaendig ist', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);
      const discordId = `discord-${randomUUID()}`;
      await setVerificationStatus(guildId, discordId, 'VERIFIED');

      await expect(getCurrentClassName(guildId, discordId)).rejects.toBeInstanceOf(PermissionError);
    });

    it('assignClass wirft PermissionError, wenn das Profil vollstaendig ist, aber noch keine Fachrichtung gewaehlt wurde', async () => {
      const { guildId, guildConfig } = await setupGuildWithClasses();
      const discordId = `discord-${randomUUID()}`;
      await setVerificationStatus(guildId, discordId, 'VERIFIED');
      await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
      const member = fakeGuildMember(discordId);

      await expect(assignClass(member, guildConfig, 'A', discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('getCurrentClassName wirft PermissionError, wenn noch keine Fachrichtung gewaehlt wurde', async () => {
      const { guildId } = await setupGuildWithClasses();
      const discordId = `discord-${randomUUID()}`;
      await setVerificationStatus(guildId, discordId, 'VERIFIED');
      await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });

      await expect(getCurrentClassName(guildId, discordId)).rejects.toBeInstanceOf(PermissionError);
    });
  });
});

import { randomUUID } from 'node:crypto';
import { DiscordAPIError, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getMember, setVerificationStatus } from '../src/repositories/memberRepository.js';
import { upsertLocation } from '../src/repositories/locationRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  assertProfileComplete,
  completeProfileAndSetNickname,
  selectLocation,
  submitPersonalDetails,
  updatePersonalDetailsAsAdmin,
} from '../src/services/memberProfileService.js';
import { NotFoundError, PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeGuildMember(
  discordId: string,
  options: {
    isAdministrator?: boolean;
    setNicknameImpl?: (nickname: string, reason?: string) => Promise<unknown>;
    nickname?: string | null;
  } = {},
): GuildMember {
  const setNickname = options.setNicknameImpl ?? vi.fn(async () => undefined);

  return {
    id: discordId,
    nickname: options.nickname ?? null,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
    setNickname: vi.fn(setNickname),
  } as unknown as GuildMember;
}

async function setupVerifiedGuildAndMember(): Promise<{
  guildId: string;
  guildConfig: Awaited<ReturnType<typeof getOrCreateGuildConfig>>;
  discordId: string;
}> {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  const discordId = `discord-${randomUUID()}`;
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  return { guildId, guildConfig, discordId };
}

describe('memberProfileService', () => {
  describe('assertProfileComplete', () => {
    it('wirft PermissionError, wenn kein Member-Datensatz existiert', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);

      await expect(
        assertProfileComplete(guildId, `discord-${randomUUID()}`),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('wirft PermissionError, wenn profileCompletedAt noch nicht gesetzt ist', async () => {
      const { guildId, discordId } = await setupVerifiedGuildAndMember();

      await expect(assertProfileComplete(guildId, discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });
  });

  describe('submitPersonalDetails', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeGuildMember(`discord-${randomUUID()}`);

      await expect(
        submitPersonalDetails(
          guildConfig,
          member,
          { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
          member.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('wirft ValidationError bei leerem Vornamen', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await expect(
        submitPersonalDetails(
          guildConfig,
          member,
          { vorname: '   ', nachname: 'Mustermann', alter: 25 },
          member.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('wirft ValidationError bei einem Alter ausserhalb des zulaessigen Bereichs', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await expect(
        submitPersonalDetails(
          guildConfig,
          member,
          { vorname: 'Max', nachname: 'Mustermann', alter: 5 },
          member.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('speichert gueltige Angaben, ohne das Profil bereits abzuschliessen', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
        member.id,
      );

      const stored = await getMember(guildId, discordId);
      expect(stored?.firstName).toBe('Max');
      expect(stored?.lastName).toBe('Mustermann');
      expect(stored?.age).toBe(25);
      expect(stored?.profileCompletedAt).toBeNull();
    });

    it('schreibt einen Audit-Log-Eintrag ohne die eingegebenen Klartext-Werte', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Geheimvorname', nachname: 'Geheimnachname', alter: 25 },
        member.id,
      );

      const entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      const entry = entries.find((e) => e.action === 'member.profile_details_set');
      expect(entry).toBeDefined();
      expect(entry?.metadata).not.toContain('Geheimvorname');
      expect(entry?.metadata).not.toContain('Geheimnachname');
      expect(JSON.parse(entry?.metadata ?? '{}')).toEqual({
        fieldsChanged: ['firstName', 'lastName', 'age'],
      });
    });
  });

  describe('selectLocation', () => {
    it('wirft ValidationError fuer eine unbekannte/inaktive Standort-ID (fail-closed gegen manipulierte IDs)', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await expect(
        selectLocation(guildConfig, member, `unbekannt-${randomUUID()}`, member.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('setzt die locationId bei einem gueltigen, aktiven Standort', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);
      const { location } = await upsertLocation({
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Test',
        state: 'Teststate',
        city: 'Teststadt',
        postalCode: '11111',
      });

      await selectLocation(guildConfig, member, location.id, member.id);

      const stored = await getMember(guildId, discordId);
      expect(stored?.locationId).toBe(location.id);
    });
  });

  describe('completeProfileAndSetNickname', () => {
    it('wirft ValidationError, wenn persoenliche Angaben noch fehlen', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);

      await expect(
        completeProfileAndSetNickname(guildConfig, member, member.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('wirft ValidationError, wenn noch kein Standort gewaehlt wurde', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);
      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
        member.id,
      );

      await expect(
        completeProfileAndSetNickname(guildConfig, member, member.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('wirft NotFoundError, wenn kein Member-Datensatz existiert', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeGuildMember(`discord-${randomUUID()}`);

      await expect(
        completeProfileAndSetNickname(guildConfig, member, member.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('setzt profileCompletedAt, ruft setNickname mit "Vorname Nachname" auf und schreibt ein Audit-Log ohne Klartext-Werte', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);
      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
        member.id,
      );
      const { location } = await upsertLocation({
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Test',
        state: 'Teststate',
        city: 'Teststadt',
        postalCode: '11111',
      });
      await selectLocation(guildConfig, member, location.id, member.id);

      const result = await completeProfileAndSetNickname(guildConfig, member, member.id);

      expect(result.nickname).toBe('Max Mustermann');
      expect(result.nicknameChanged).toBe(true);
      expect(result.nicknameSkipped).toBe(false);
      expect(member.setNickname).toHaveBeenCalledWith('Max Mustermann', expect.any(String));

      const stored = await getMember(guildId, discordId);
      expect(stored?.profileCompletedAt).not.toBeNull();

      const entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      const entry = entries.find((e) => e.action === 'member.profile_completed');
      expect(entry).toBeDefined();
      expect(entry?.metadata).not.toContain('Max');
      expect(entry?.metadata).not.toContain('Mustermann');
    });

    it('blockiert den Profilabschluss NICHT, wenn Discord das Setzen des Nicknamens ablehnt (fehlende Berechtigung/Owner)', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId, {
        setNicknameImpl: async () => {
          throw new DiscordAPIError(
            { code: 50013, message: 'Missing Permissions' },
            50013,
            403,
            'PATCH',
            '/guilds/x/members/y',
            { body: undefined, files: undefined },
          );
        },
      });
      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
        member.id,
      );
      const { location } = await upsertLocation({
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Test',
        state: 'Teststate',
        city: 'Teststadt',
        postalCode: '11111',
      });
      await selectLocation(guildConfig, member, location.id, member.id);

      const result = await completeProfileAndSetNickname(guildConfig, member, member.id);

      expect(result.nicknameSkipped).toBe(true);
      expect(result.nicknameChanged).toBe(false);

      const stored = await getMember(guildId, discordId);
      expect(stored?.profileCompletedAt).not.toBeNull();
    });

    it('ist idempotent: ein zweiter Aufruf erzeugt keinen zweiten Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const member = fakeGuildMember(discordId);
      await submitPersonalDetails(
        guildConfig,
        member,
        { vorname: 'Max', nachname: 'Mustermann', alter: 25 },
        member.id,
      );
      const { location } = await upsertLocation({
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Test',
        state: 'Teststate',
        city: 'Teststadt',
        postalCode: '11111',
      });
      await selectLocation(guildConfig, member, location.id, member.id);
      await completeProfileAndSetNickname(guildConfig, member, member.id);

      await completeProfileAndSetNickname(guildConfig, member, member.id);

      const entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(entries.filter((e) => e.action === 'member.profile_completed')).toHaveLength(1);
    });
  });

  describe('updatePersonalDetailsAsAdmin', () => {
    it('wirft PermissionError fuer einen nicht-administrativen Aufrufer', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const target = fakeGuildMember(discordId);
      const actingMember = fakeGuildMember(`discord-${randomUUID()}`, { isAdministrator: false });

      await expect(
        updatePersonalDetailsAsAdmin(
          guildConfig,
          actingMember,
          target,
          { vorname: 'Neu' },
          actingMember.id,
        ),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('wirft ValidationError, wenn keine Aenderung angegeben wurde', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const target = fakeGuildMember(discordId);
      const admin = fakeGuildMember(`discord-${randomUUID()}`, { isAdministrator: true });

      await expect(
        updatePersonalDetailsAsAdmin(guildConfig, admin, target, {}, admin.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('aktualisiert Vor-/Nachname und synchronisiert dabei den Nicknamen', async () => {
      const { guildId, guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const target = fakeGuildMember(discordId);
      const admin = fakeGuildMember(`discord-${randomUUID()}`, { isAdministrator: true });

      const result = await updatePersonalDetailsAsAdmin(
        guildConfig,
        admin,
        target,
        { vorname: 'Erika', nachname: 'Musterfrau' },
        admin.id,
      );

      expect(result.nicknameChanged).toBe(true);
      expect(target.setNickname).toHaveBeenCalledWith('Erika Musterfrau', expect.any(String));

      const stored = await getMember(guildId, discordId);
      expect(stored?.firstName).toBe('Erika');
      expect(stored?.lastName).toBe('Musterfrau');

      const entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      const entry = entries.find((e) => e.action === 'member.profile_updated_by_admin');
      expect(entry).toBeDefined();
      expect(entry?.metadata).not.toContain('Erika');
      expect(entry?.actorDiscordId).toBe(admin.id);
    });

    it('wirft ValidationError bei einer unbekannten/inaktiven Standort-ID', async () => {
      const { guildConfig, discordId } = await setupVerifiedGuildAndMember();
      const target = fakeGuildMember(discordId);
      const admin = fakeGuildMember(`discord-${randomUUID()}`, { isAdministrator: true });

      await expect(
        updatePersonalDetailsAsAdmin(
          guildConfig,
          admin,
          target,
          { standortId: `unbekannt-${randomUUID()}` },
          admin.id,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

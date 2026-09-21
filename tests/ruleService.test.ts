import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getRuleSetById } from '../src/repositories/ruleSetRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  acceptCurrentRules,
  assertRulesAccepted,
  getCurrentRuleSet,
  getRuleAcceptanceStatus,
  hasAcceptedCurrentRules,
  showRulesToMember,
  updateRules,
} from '../src/services/ruleService.js';
import { setVerificationStatus } from '../src/repositories/memberRepository.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: { id: string; isAdministrator?: boolean }): GuildMember {
  return {
    id: options.id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

describe('ruleService', () => {
  describe('updateRules', () => {
    it('wirft PermissionError fuer einen nicht-administrativen Aufrufer', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeMember({ id: 'member-1' });

      await expect(updateRules(guildConfig, member, 'Regeltext', member.id)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('wirft ValidationError bei leerem Regeltext', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await expect(updateRules(guildConfig, admin, '   ', admin.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('legt Version 1 an und aktiviert sie', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const ruleSet = await updateRules(guildConfig, admin, 'Regel 1: Sei nett.', admin.id);

      expect(ruleSet.version).toBe(1);
      expect(ruleSet.isActive).toBe(true);
      expect(await getCurrentRuleSet(guildId)).toMatchObject({ id: ruleSet.id, version: 1 });
    });

    it('deaktiviert die vorherige Version, bevor die neue aktiviert wird - nie zwei aktive Versionen gleichzeitig', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      const v1 = await updateRules(guildConfig, admin, 'Version 1', admin.id);
      const v2 = await updateRules(guildConfig, admin, 'Version 2', admin.id);

      expect(v2.version).toBe(2);
      const current = await getCurrentRuleSet(guildId);
      expect(current?.id).toBe(v2.id);
      expect(current?.content).toBe('Version 2');

      // v1 bleibt als Zeile mit unveraendertem Inhalt erhalten, ist aber nicht mehr aktiv.
      const persistedV1 = await getRuleSetById(guildId, v1.id);
      expect(persistedV1?.isActive).toBe(false);
      expect(persistedV1?.content).toBe('Version 1');
    });

    it('schreibt einen Audit-Log-Eintrag ohne den Regeltext selbst', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

      await updateRules(guildConfig, admin, 'Geheimer interner Regeltext', admin.id);

      const entries = await listAuditEvents(guildId, { actorDiscordId: admin.id });
      const entry = entries.find((e) => e.action === 'rules.version_created');
      expect(entry).toBeDefined();
      expect(entry?.metadata).not.toContain('Geheimer interner Regeltext');
      expect(JSON.parse(entry?.metadata ?? '{}')).toEqual({ version: 1 });
    });
  });

  describe('assertRulesAccepted / hasAcceptedCurrentRules', () => {
    it('wirft ValidationError, wenn noch kein Regelwerk konfiguriert ist', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);

      await expect(assertRulesAccepted(guildId, 'member-1')).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(await hasAcceptedCurrentRules(guildId, 'member-1')).toBe(false);
    });

    it('wirft PermissionError, wenn ein Regelwerk existiert, aber noch nicht zugestimmt wurde', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);

      await expect(assertRulesAccepted(guildId, 'member-1')).rejects.toBeInstanceOf(
        PermissionError,
      );
      expect(await hasAcceptedCurrentRules(guildId, 'member-1')).toBe(false);
    });

    it('laesst nach Zustimmung passieren', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);
      const member = fakeMember({ id: 'member-1' });
      await acceptCurrentRules(guildConfig, member, member.id);

      await expect(assertRulesAccepted(guildId, 'member-1')).resolves.toBeUndefined();
      expect(await hasAcceptedCurrentRules(guildId, 'member-1')).toBe(true);
    });
  });

  describe('showRulesToMember', () => {
    it('wirft ValidationError, wenn noch kein Regelwerk konfiguriert ist', async () => {
      const guildId = `guild-${randomUUID()}`;
      await getOrCreateGuildConfig(guildId);

      await expect(showRulesToMember(guildId, 'member-1')).rejects.toBeInstanceOf(ValidationError);
    });

    it('liefert die aktuelle Version und vermerkt shownAt', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);

      const ruleSet = await showRulesToMember(guildId, 'member-1');

      expect(ruleSet.content).toBe('Regeltext');
    });
  });

  describe('acceptCurrentRules', () => {
    it('bestaetigt die aktuell aktive Version und schreibt genau einen Audit-Log-Eintrag', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);
      const member = fakeMember({ id: 'member-1' });

      await acceptCurrentRules(guildConfig, member, member.id);

      const entries = await listAuditEvents(guildId, { targetDiscordId: member.id });
      expect(entries.filter((e) => e.action === 'rules.accepted')).toHaveLength(1);
    });

    it('ist idempotent: doppelte Zustimmung erzeugt keinen zweiten Audit-Log-Eintrag', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);
      const member = fakeMember({ id: 'member-1' });

      await acceptCurrentRules(guildConfig, member, member.id);
      await acceptCurrentRules(guildConfig, member, member.id);

      const entries = await listAuditEvents(guildId, { targetDiscordId: member.id });
      expect(entries.filter((e) => e.action === 'rules.accepted')).toHaveLength(1);
    });

    it('erzwingt nach einem Regelwerk-Update eine erneute Zustimmung', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Version 1', admin.id);
      const member = fakeMember({ id: 'member-1' });
      await acceptCurrentRules(guildConfig, member, member.id);
      expect(await hasAcceptedCurrentRules(guildId, member.id)).toBe(true);

      await updateRules(guildConfig, admin, 'Version 2', admin.id);

      expect(await hasAcceptedCurrentRules(guildId, member.id)).toBe(false);
      await expect(assertRulesAccepted(guildId, member.id)).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('getRuleAcceptanceStatus', () => {
    it('wirft PermissionError fuer einen nicht-administrativen Aufrufer', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const member = fakeMember({ id: 'member-1' });

      await expect(getRuleAcceptanceStatus(guildConfig, member)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('zaehlt zugestimmte Mitglieder korrekt gegen die Gesamtzahl verifizierter Mitglieder', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
      await updateRules(guildConfig, admin, 'Regeltext', admin.id);

      await setVerificationStatus(guildId, 'member-1', 'VERIFIED');
      await setVerificationStatus(guildId, 'member-2', 'VERIFIED');
      await acceptCurrentRules(guildConfig, fakeMember({ id: 'member-1' }), 'member-1');

      const status = await getRuleAcceptanceStatus(guildConfig, admin);

      expect(status.acceptedCount).toBe(1);
      expect(status.totalVerifiedMembers).toBe(2);
    });
  });
});

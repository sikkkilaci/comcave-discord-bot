import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  getOrCreateGuildConfig,
  updateGuildConfig,
} from '../src/repositories/guildConfigRepository.js';
import {
  setVerificationStatus,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { setMemberClass, setMemberFachrichtung } from '../src/repositories/memberRepository.js';
import { getOrCreateClass } from '../src/repositories/classRepository.js';
import { updateRules, acceptCurrentRules } from '../src/services/ruleService.js';
import { submitAnswer } from '../src/services/onboardingService.js';
import {
  grantOnboardedRoleIfComplete,
  resolveNextJourneyStep,
} from '../src/services/memberJourneyService.js';

function fakeMember(id: string, isAdministrator = false): GuildMember {
  return {
    id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => isAdministrator },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

/** Wie fakeMember(), aber mit einem echten (mockbaren) roles.add()/cache.has() fuer die Rollenvergabe. */
function fakeMemberWithRoles(id: string, initialRoleIds: string[] = []): GuildMember {
  const roleIds = new Set(initialRoleIds);
  return {
    id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => false },
    roles: {
      cache: { has: (roleId: string) => roleIds.has(roleId) },
      add: vi.fn(async (roleId: string) => {
        roleIds.add(roleId);
      }),
    },
  } as unknown as GuildMember;
}

/**
 * Verifiziert + Pflichtprofil vollstaendig - Zustand direkt vor der
 * Fachrichtungswahl. Der COMCAVE-Standort ist bewusst kein Bestandteil
 * (kein Pflichtschritt mehr im Eintrittsflow, siehe memberJourneyService.ts).
 */
async function prepareCompleteProfile(guildId: string, discordId: string): Promise<void> {
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  await updatePersonalDetails(guildId, discordId, {
    firstName: 'Max',
    lastName: 'Mustermann',
    age: 25,
    profileCompletedAt: new Date(),
  });
}

describe('resolveNextJourneyStep', () => {
  it('NEEDS_VERIFICATION, wenn kein Member-Datensatz existiert oder nicht verifiziert ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_VERIFICATION');

    await setVerificationStatus(guildId, discordId, 'PENDING');
    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_VERIFICATION');
  });

  it('NEEDS_PROFILE_DETAILS, wenn verifiziert, aber Vorname/Nachname/Alter fehlen', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await setVerificationStatus(guildId, discordId, 'VERIFIED');

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_PROFILE_DETAILS');
  });

  it('NEEDS_FACHRICHTUNG, wenn das Profil vollstaendig ist, aber noch keine Fachrichtung gewaehlt wurde', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await prepareCompleteProfile(guildId, discordId);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_FACHRICHTUNG');
  });

  it('NEEDS_CLASS, wenn die Fachrichtung gewaehlt ist, aber noch keine Klasse', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_CLASS');
  });

  it('NEEDS_ONBOARDING, wenn Fachrichtung und Klasse gewaehlt sind, aber das Onboarding noch offen ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
    const klasse = await getOrCreateClass(guildId, 'A');
    await setMemberClass(guildId, discordId, klasse.id);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_ONBOARDING');
  });

  it('NEEDS_RULES_ACCEPTANCE, wenn Fachrichtung/Klasse/Onboarding erledigt sind, aber noch nicht den aktuellen Regeln zugestimmt wurde', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
    const klasse = await getOrCreateClass(guildId, 'A');
    await setMemberClass(guildId, discordId, klasse.id);
    await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
    await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_RULES_ACCEPTANCE');
  });

  it('COMPLETE, wenn alle Schritte abgeschlossen sind', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
    const klasse = await getOrCreateClass(guildId, 'A');
    await setMemberClass(guildId, discordId, klasse.id);
    await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
    await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);
    await updateRules(guildConfig, fakeMember('admin-1', true), 'Regeltext', 'admin-1');
    await acceptCurrentRules(guildConfig, fakeMember(discordId), discordId);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('COMPLETE');
  });
});

describe('grantOnboardedRoleIfComplete', () => {
  async function prepareCompletedMember(
    guildId: string,
    discordId: string,
  ): Promise<Awaited<ReturnType<typeof getOrCreateGuildConfig>>> {
    const guildConfig = await getOrCreateGuildConfig(guildId);
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
    const klasse = await getOrCreateClass(guildId, 'A');
    await setMemberClass(guildId, discordId, klasse.id);
    await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
    await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);
    await updateRules(guildConfig, fakeMember('admin-1', true), 'Regeltext', 'admin-1');
    await acceptCurrentRules(guildConfig, fakeMember(discordId), discordId);
    return getOrCreateGuildConfig(guildId);
  }

  it('vergibt die Mitglied-Rolle, sobald der komplette Eintrittsflow abgeschlossen ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    const discordId = `discord-${randomUUID()}`;
    await updateGuildConfig(guildId, { onboardedRoleId: 'role-onboarded' });
    const guildConfig = await prepareCompletedMember(guildId, discordId);
    const member = fakeMemberWithRoles(discordId);

    await grantOnboardedRoleIfComplete(member, guildConfig, discordId);

    expect(member.roles.add).toHaveBeenCalledWith('role-onboarded', expect.any(String));
    expect(member.roles.cache.has('role-onboarded')).toBe(true);
  });

  it('vergibt KEINE Rolle, wenn der Eintrittsflow noch nicht komplett ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    const discordId = `discord-${randomUUID()}`;
    const guildConfig = await updateGuildConfig(guildId, { onboardedRoleId: 'role-onboarded' });
    await setVerificationStatus(guildId, discordId, 'VERIFIED');
    const member = fakeMemberWithRoles(discordId);

    await grantOnboardedRoleIfComplete(member, guildConfig, discordId);

    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('ist idempotent: ruft roles.add() nicht erneut auf, wenn die Rolle schon vorhanden ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    const discordId = `discord-${randomUUID()}`;
    await updateGuildConfig(guildId, { onboardedRoleId: 'role-onboarded' });
    const guildConfig = await prepareCompletedMember(guildId, discordId);
    const member = fakeMemberWithRoles(discordId, ['role-onboarded']);

    await grantOnboardedRoleIfComplete(member, guildConfig, discordId);

    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('tut nichts, wenn noch keine onboardedRoleId konfiguriert ist (z.B. vor /setup-server)', async () => {
    const guildId = `guild-${randomUUID()}`;
    const discordId = `discord-${randomUUID()}`;
    const guildConfig = await prepareCompletedMember(guildId, discordId);
    const member = fakeMemberWithRoles(discordId);

    await expect(
      grantOnboardedRoleIfComplete(member, guildConfig, discordId),
    ).resolves.toBeUndefined();
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('vergibt die Mitglied-Rolle NICHT, solange keine Klasse bestaetigt ist - auch wenn Profil und Fachrichtung bereits vollstaendig sind', async () => {
    const guildId = `guild-${randomUUID()}`;
    const discordId = `discord-${randomUUID()}`;
    const guildConfig = await updateGuildConfig(guildId, { onboardedRoleId: 'role-onboarded' });
    await prepareCompleteProfile(guildId, discordId);
    await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
    // Bewusst KEINE Klasse zugewiesen - der naechste offene Schritt ist NEEDS_CLASS.
    const member = fakeMemberWithRoles(discordId);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_CLASS');

    await grantOnboardedRoleIfComplete(member, guildConfig, discordId);

    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.cache.has('role-onboarded')).toBe(false);
  });
});

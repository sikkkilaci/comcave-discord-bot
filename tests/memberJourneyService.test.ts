import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  setVerificationStatus,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { upsertLocation } from '../src/repositories/locationRepository.js';
import { updateRules, acceptCurrentRules } from '../src/services/ruleService.js';
import { submitAnswer } from '../src/services/onboardingService.js';
import { resolveNextJourneyStep } from '../src/services/memberJourneyService.js';

function fakeMember(id: string, isAdministrator = false): GuildMember {
  return {
    id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => isAdministrator },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
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

  it('NEEDS_LOCATION, wenn persoenliche Angaben vorhanden sind, aber kein Standort/Abschluss', async () => {
    const guildId = `guild-${randomUUID()}`;
    await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await setVerificationStatus(guildId, discordId, 'VERIFIED');
    await updatePersonalDetails(guildId, discordId, {
      firstName: 'Max',
      lastName: 'Mustermann',
      age: 25,
    });

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_LOCATION');
  });

  it('NEEDS_RULES_ACCEPTANCE, wenn das Profil vollstaendig ist, aber noch nicht den aktuellen Regeln zugestimmt wurde', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await setVerificationStatus(guildId, discordId, 'VERIFIED');
    const { location } = await upsertLocation({
      code: `code-${randomUUID()}`,
      name: 'COMCAVE Test',
      state: 'Teststate',
      city: 'Teststadt',
      postalCode: '11111',
    });
    await updatePersonalDetails(guildId, discordId, {
      firstName: 'Max',
      lastName: 'Mustermann',
      age: 25,
      locationId: location.id,
      profileCompletedAt: new Date(),
    });
    await updateRules(guildConfig, fakeMember('admin-1', true), 'Regeltext', 'admin-1');

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_RULES_ACCEPTANCE');
  });

  it('NEEDS_ONBOARDING, wenn Profil und Regeln erledigt sind, aber das Onboarding noch offen ist', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await setVerificationStatus(guildId, discordId, 'VERIFIED');
    const { location } = await upsertLocation({
      code: `code-${randomUUID()}`,
      name: 'COMCAVE Test',
      state: 'Teststate',
      city: 'Teststadt',
      postalCode: '11111',
    });
    await updatePersonalDetails(guildId, discordId, {
      firstName: 'Max',
      lastName: 'Mustermann',
      age: 25,
      locationId: location.id,
      profileCompletedAt: new Date(),
    });
    await updateRules(guildConfig, fakeMember('admin-1', true), 'Regeltext', 'admin-1');
    await acceptCurrentRules(guildConfig, fakeMember(discordId), discordId);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('NEEDS_ONBOARDING');
  });

  it('COMPLETE, wenn alle Schritte abgeschlossen sind', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const discordId = `discord-${randomUUID()}`;
    await setVerificationStatus(guildId, discordId, 'VERIFIED');
    const { location } = await upsertLocation({
      code: `code-${randomUUID()}`,
      name: 'COMCAVE Test',
      state: 'Teststate',
      city: 'Teststadt',
      postalCode: '11111',
    });
    await updatePersonalDetails(guildId, discordId, {
      firstName: 'Max',
      lastName: 'Mustermann',
      age: 25,
      locationId: location.id,
      profileCompletedAt: new Date(),
    });
    await updateRules(guildConfig, fakeMember('admin-1', true), 'Regeltext', 'admin-1');
    await acceptCurrentRules(guildConfig, fakeMember(discordId), discordId);
    await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
    await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);

    expect(await resolveNextJourneyStep(guildId, discordId)).toBe('COMPLETE');
  });
});

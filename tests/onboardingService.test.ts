import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getMember,
  setVerificationStatus,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { createNewActiveRuleSet } from '../src/repositories/ruleSetRepository.js';
import { acceptRules } from '../src/repositories/ruleAcceptanceRepository.js';
import {
  assertMemberVerified,
  getOnboardingState,
  submitAnswer,
} from '../src/services/onboardingService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function uniqueIds(): { guildId: string; discordId: string } {
  return { guildId: `guild-${randomUUID()}`, discordId: `discord-${randomUUID()}` };
}

/** Verifiziert + Profil vollstaendig + Regeln akzeptiert - der "startklar fuer Onboarding"-Zustand. */
async function createVerifiedMember(): Promise<{ guildId: string; discordId: string }> {
  const { guildId, discordId } = uniqueIds();
  await getOrCreateGuildConfig(guildId);
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
  const ruleSet = await createNewActiveRuleSet(guildId, 'Testregeln', 'admin-test');
  await acceptRules(guildId, discordId, ruleSet.id);
  return { guildId, discordId };
}

describe('onboardingService', () => {
  describe('assertMemberVerified', () => {
    it('wirft PermissionError, wenn kein Member-Datensatz existiert', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);

      await expect(assertMemberVerified(guildId, discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('wirft PermissionError, wenn der Status nicht VERIFIED ist', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);
      await setVerificationStatus(guildId, discordId, 'PENDING');

      await expect(assertMemberVerified(guildId, discordId)).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('gibt das Mitglied zurueck, wenn es verifiziert ist', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      const member = await assertMemberVerified(guildId, discordId);

      expect(member.discordId).toBe(discordId);
    });
  });

  describe('getOnboardingState', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);

      await expect(getOnboardingState(guildId, discordId)).rejects.toBeInstanceOf(PermissionError);
    });

    it('liefert IT_EXPERIENCE als erste Frage ohne vorherige Antworten', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      const state = await getOnboardingState(guildId, discordId);

      expect(state.nextQuestion).toBe('IT_EXPERIENCE');
      expect(state.complete).toBe(false);
      expect(state.answers).toEqual({});
    });
  });

  describe('submitAnswer', () => {
    it('wirft PermissionError fuer unverifizierte Mitglieder', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);

      await expect(
        submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['ANFAENGER']),
      ).rejects.toBeInstanceOf(PermissionError);
    });

    it('wirft ValidationError bei ungueltigen Werten und speichert nichts', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      await expect(
        submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['UNGUELTIG']),
      ).rejects.toBeInstanceOf(ValidationError);

      const state = await getOnboardingState(guildId, discordId);
      expect(state.answers).toEqual({});
    });

    it('speichert IT_EXPERIENCE und denormalisiert es auf Member.itExperienceLevel', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      const state = await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['FORTGESCHRITTEN']);

      expect(state.nextQuestion).toBe('IT_SKILLS');
      expect(state.complete).toBe(false);

      const member = await getMember(guildId, discordId);
      expect(member?.itExperienceLevel).toBe('FORTGESCHRITTEN');
    });

    it('springt bei IT_EXPERIENCE=KEINE direkt zu INTERESTS', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      const state = await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);

      expect(state.nextQuestion).toBe('INTERESTS');
    });

    it('speichert INTERESTS und denormalisiert es als JSON auf Member.interests', async () => {
      const { guildId, discordId } = await createVerifiedMember();
      await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);

      const state = await submitAnswer(guildId, discordId, 'INTERESTS', [
        'CYBERSECURITY',
        'SONSTIGES',
      ]);

      expect(state.complete).toBe(true);
      expect(state.nextQuestion).toBeNull();

      const member = await getMember(guildId, discordId);
      expect(JSON.parse(member?.interests ?? '[]')).toEqual(['CYBERSECURITY', 'SONSTIGES']);
    });

    it('durchlaeuft den vollen Pfad (Erfahrung vorhanden) bis zum Abschluss', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      let state = await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['ERFAHREN']);
      expect(state.nextQuestion).toBe('IT_SKILLS');

      state = await submitAnswer(guildId, discordId, 'IT_SKILLS', [
        'PROGRAMMIERUNG',
        'DATENBANKEN',
      ]);
      expect(state.nextQuestion).toBe('IT_BACKGROUND');

      state = await submitAnswer(guildId, discordId, 'IT_BACKGROUND', ['BERUFSERFAHRUNG']);
      expect(state.nextQuestion).toBe('INTERESTS');

      state = await submitAnswer(guildId, discordId, 'INTERESTS', ['ADMINISTRATION_CLOUD']);
      expect(state.nextQuestion).toBeNull();
      expect(state.complete).toBe(true);
    });

    it('schreibt bei Abschluss einen Audit-Log-Eintrag "member.onboarding_complete"', async () => {
      const { guildId, discordId } = await createVerifiedMember();

      await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
      let entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      expect(entries.some((entry) => entry.action === 'member.onboarding_complete')).toBe(false);

      await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);
      entries = await listAuditEvents(guildId, { targetDiscordId: discordId });
      const completionEntry = entries.find(
        (entry) => entry.action === 'member.onboarding_complete',
      );
      expect(completionEntry).toBeDefined();
      expect(completionEntry?.actorDiscordId).toBe(discordId);
    });

    it('ist per Redo erneut vollstaendig ausfuellbar, ohne alte Antworten zu verlieren', async () => {
      const { guildId, discordId } = await createVerifiedMember();
      await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);
      await submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']);

      // Redo: von vorne beginnen mit einer anderen Erfahrungsstufe.
      const state = await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['ANFAENGER']);

      expect(state.nextQuestion).toBe('IT_SKILLS');
      const member = await getMember(guildId, discordId);
      expect(member?.itExperienceLevel).toBe('ANFAENGER');
      // Alte INTERESTS-Antwort bleibt erhalten, bis sie explizit neu beantwortet wird.
      expect(JSON.parse(member?.interests ?? '[]')).toEqual(['SONSTIGES']);
    });
  });

  describe('Profil-/Regel-Guard (Umgehungsschutz)', () => {
    it('getOnboardingState wirft PermissionError, wenn das Profil trotz Verifizierung nicht vollstaendig ist', async () => {
      const { guildId, discordId } = uniqueIds();
      await getOrCreateGuildConfig(guildId);
      await setVerificationStatus(guildId, discordId, 'VERIFIED');

      await expect(getOnboardingState(guildId, discordId)).rejects.toBeInstanceOf(PermissionError);
    });

    it(
      'submitAnswer wirft PermissionError, wenn das Profil trotz Verifizierung nicht vollstaendig ist ' +
        '(kein Umgehen der Pflichtangaben durch direkten /onboarding-Aufruf)',
      async () => {
        const { guildId, discordId } = uniqueIds();
        await getOrCreateGuildConfig(guildId);
        await setVerificationStatus(guildId, discordId, 'VERIFIED');

        await expect(
          submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['ANFAENGER']),
        ).rejects.toBeInstanceOf(PermissionError);
      },
    );

    it(
      'getOnboardingState wirft PermissionError, wenn das Profil vollstaendig ist, aber die aktuellen ' +
        'Regeln noch nicht akzeptiert wurden',
      async () => {
        const { guildId, discordId } = uniqueIds();
        await getOrCreateGuildConfig(guildId);
        await setVerificationStatus(guildId, discordId, 'VERIFIED');
        await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
        await createNewActiveRuleSet(guildId, 'Testregeln', 'admin-test');

        await expect(getOnboardingState(guildId, discordId)).rejects.toBeInstanceOf(
          PermissionError,
        );
      },
    );

    it(
      'submitAnswer wirft erneut PermissionError, wenn nach einem Regelwerk-Update noch nicht der ' +
        'neuen Version zugestimmt wurde (keine dauerhafte Umgehung durch alte Zustimmung)',
      async () => {
        const { guildId, discordId } = await createVerifiedMember();
        await submitAnswer(guildId, discordId, 'IT_EXPERIENCE', ['KEINE']);

        // Neue Regelversion - die bisherige Zustimmung bezieht sich nur auf die alte Version.
        await createNewActiveRuleSet(guildId, 'Aktualisierte Testregeln', 'admin-test');

        await expect(
          submitAnswer(guildId, discordId, 'INTERESTS', ['SONSTIGES']),
        ).rejects.toBeInstanceOf(PermissionError);
      },
    );
  });
});

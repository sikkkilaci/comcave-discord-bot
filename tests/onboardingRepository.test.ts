import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateMember } from '../src/repositories/memberRepository.js';
import { getLatestAnswers, recordAnswer } from '../src/repositories/onboardingRepository.js';

async function createMember(): Promise<string> {
  const guildId = `guild-${randomUUID()}`;
  await getOrCreateGuildConfig(guildId);
  const member = await getOrCreateMember(guildId, `discord-${randomUUID()}`);
  return member.id;
}

describe('onboardingRepository', () => {
  describe('recordAnswer / getLatestAnswers', () => {
    it('gibt ein leeres Objekt zurueck, wenn noch keine Antworten existieren', async () => {
      const memberId = await createMember();

      const answers = await getLatestAnswers(memberId);

      expect(answers).toEqual({});
    });

    it('speichert eine Antwort und liefert sie als Array zurueck', async () => {
      const memberId = await createMember();

      await recordAnswer(memberId, 'IT_EXPERIENCE', ['ANFAENGER']);
      const answers = await getLatestAnswers(memberId);

      expect(answers.IT_EXPERIENCE).toEqual(['ANFAENGER']);
    });

    it('speichert Mehrfachauswahl-Antworten als Array', async () => {
      const memberId = await createMember();

      await recordAnswer(memberId, 'IT_SKILLS', ['PROGRAMMIERUNG', 'WEBENTWICKLUNG']);
      const answers = await getLatestAnswers(memberId);

      expect(answers.IT_SKILLS).toEqual(['PROGRAMMIERUNG', 'WEBENTWICKLUNG']);
    });

    it('behaelt fuer verschiedene Fragen jeweils die eigene Antwort', async () => {
      const memberId = await createMember();

      await recordAnswer(memberId, 'IT_EXPERIENCE', ['ERFAHREN']);
      await recordAnswer(memberId, 'INTERESTS', ['CYBERSECURITY']);
      const answers = await getLatestAnswers(memberId);

      expect(answers.IT_EXPERIENCE).toEqual(['ERFAHREN']);
      expect(answers.INTERESTS).toEqual(['CYBERSECURITY']);
    });

    it('verwendet bei erneuter Antwort auf dieselbe Frage den zuletzt gespeicherten Wert (Redo)', async () => {
      const memberId = await createMember();

      await recordAnswer(memberId, 'IT_EXPERIENCE', ['KEINE']);
      // Kleine Pause, damit createdAt garantiert unterschiedlich ist.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await recordAnswer(memberId, 'IT_EXPERIENCE', ['ERFAHREN']);

      const answers = await getLatestAnswers(memberId);

      expect(answers.IT_EXPERIENCE).toEqual(['ERFAHREN']);
    });

    it('trennt Antworten unterschiedlicher Mitglieder', async () => {
      const memberIdA = await createMember();
      const memberIdB = await createMember();

      await recordAnswer(memberIdA, 'IT_EXPERIENCE', ['KEINE']);
      await recordAnswer(memberIdB, 'IT_EXPERIENCE', ['ERFAHREN']);

      const answersA = await getLatestAnswers(memberIdA);
      const answersB = await getLatestAnswers(memberIdB);

      expect(answersA.IT_EXPERIENCE).toEqual(['KEINE']);
      expect(answersB.IT_EXPERIENCE).toEqual(['ERFAHREN']);
    });
  });
});

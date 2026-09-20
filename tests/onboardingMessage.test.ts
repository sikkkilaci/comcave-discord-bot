import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_RESTART_CUSTOM_ID,
  buildAnswerCustomId,
  buildOnboardingMessageForState,
  buildOnboardingStepMessage,
  buildOnboardingSummaryMessage,
  parseAnswerCustomId,
} from '../src/bot/ui/onboardingMessage.js';
import { ONBOARDING_QUESTIONS } from '../src/services/onboardingFlow.js';

interface RawSelectMenu {
  custom_id: string;
  options: { label: string; value: string }[];
  min_values: number;
  max_values: number;
}

interface RawButton {
  custom_id: string;
}

describe('onboardingMessage', () => {
  describe('buildAnswerCustomId / parseAnswerCustomId', () => {
    it('ist fuer alle Fragen umkehrbar', () => {
      for (const question of ONBOARDING_QUESTIONS) {
        expect(parseAnswerCustomId(buildAnswerCustomId(question))).toBe(question);
      }
    });

    it('gibt null fuer unbekannte oder fremde customIds zurueck', () => {
      expect(parseAnswerCustomId('onboarding:answer:UNBEKANNT')).toBeNull();
      expect(parseAnswerCustomId('verification:self-verify')).toBeNull();
    });
  });

  describe('buildOnboardingStepMessage', () => {
    it('baut ein Select-Menu mit korrekter customId und allen Optionen', () => {
      const { components } = buildOnboardingStepMessage('IT_SKILLS');
      const select = components[0]?.toJSON().components[0] as unknown as RawSelectMenu;

      expect(select.custom_id).toBe('onboarding:answer:IT_SKILLS');
      expect(select.options).toHaveLength(6);
      expect(select.options.map((option) => option.value)).toContain('PROGRAMMIERUNG');
    });

    it('konfiguriert Einzelauswahl-Fragen mit min/max_values = 1', () => {
      const { components } = buildOnboardingStepMessage('IT_EXPERIENCE');
      const select = components[0]?.toJSON().components[0] as unknown as RawSelectMenu;

      expect(select.min_values).toBe(1);
      expect(select.max_values).toBe(1);
    });

    it('konfiguriert Mehrfachauswahl-Fragen mit max_values > 1', () => {
      const { components } = buildOnboardingStepMessage('INTERESTS');
      const select = components[0]?.toJSON().components[0] as unknown as RawSelectMenu;

      expect(select.min_values).toBe(1);
      expect(select.max_values).toBeGreaterThan(1);
    });
  });

  describe('buildOnboardingSummaryMessage', () => {
    it('zeigt fuer jede beantwortete Frage ein Feld mit lesbaren Labels', () => {
      const { embeds, components } = buildOnboardingSummaryMessage({
        IT_EXPERIENCE: ['ERFAHREN'],
        INTERESTS: ['CYBERSECURITY', 'SONSTIGES'],
      });

      const embed = embeds[0]?.toJSON();
      const fieldNames = embed?.fields?.map((field) => field.name);
      expect(fieldNames).toEqual(['IT-Vorerfahrung', 'Lern- und IT-Interessen']);

      const interestsField = embed?.fields?.find(
        (field) => field.name === 'Lern- und IT-Interessen',
      );
      expect(interestsField?.value).toBe('Cybersecurity, Sonstiges');

      const button = components[0]?.toJSON().components[0] as unknown as RawButton;
      expect(button.custom_id).toBe(ONBOARDING_RESTART_CUSTOM_ID);
    });
  });

  describe('buildOnboardingMessageForState', () => {
    it('zeigt die naechste Frage, wenn das Onboarding unvollstaendig ist', () => {
      const { components } = buildOnboardingMessageForState({
        answers: {},
        nextQuestion: 'IT_EXPERIENCE',
        complete: false,
      });

      const select = components[0]?.toJSON().components[0] as unknown as RawSelectMenu;
      expect(select.custom_id).toBe('onboarding:answer:IT_EXPERIENCE');
    });

    it('zeigt die Zusammenfassung mit Restart-Button, wenn abgeschlossen', () => {
      const { components } = buildOnboardingMessageForState({
        answers: { IT_EXPERIENCE: ['KEINE'], INTERESTS: ['SONSTIGES'] },
        nextQuestion: null,
        complete: true,
      });

      const button = components[0]?.toJSON().components[0] as unknown as RawButton;
      expect(button.custom_id).toBe(ONBOARDING_RESTART_CUSTOM_ID);
    });
  });
});

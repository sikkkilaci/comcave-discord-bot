import { describe, expect, it } from 'vitest';
import {
  getNextQuestion,
  isOnboardingComplete,
  validateAnswer,
  type OnboardingAnswers,
} from '../src/services/onboardingFlow.js';
import { ValidationError } from '../src/utils/errors.js';

describe('onboardingFlow', () => {
  describe('getNextQuestion', () => {
    it('stellt IT_EXPERIENCE als allererste Frage', () => {
      expect(getNextQuestion({})).toBe('IT_EXPERIENCE');
    });

    it('fragt nach Skills, wenn IT-Erfahrung vorhanden ist', () => {
      const answers: OnboardingAnswers = { IT_EXPERIENCE: ['ANFAENGER'] };
      expect(getNextQuestion(answers)).toBe('IT_SKILLS');
    });

    it('ueberspringt IT_SKILLS und IT_BACKGROUND bei "KEINE" IT-Erfahrung', () => {
      const answers: OnboardingAnswers = { IT_EXPERIENCE: ['KEINE'] };
      expect(getNextQuestion(answers)).toBe('INTERESTS');
    });

    it('fragt IT_BACKGROUND nach IT_SKILLS, wenn Erfahrung vorhanden ist', () => {
      const answers: OnboardingAnswers = {
        IT_EXPERIENCE: ['FORTGESCHRITTEN'],
        IT_SKILLS: ['PROGRAMMIERUNG'],
      };
      expect(getNextQuestion(answers)).toBe('IT_BACKGROUND');
    });

    it('ist nach allen vier Fragen abgeschlossen (voller Pfad)', () => {
      const answers: OnboardingAnswers = {
        IT_EXPERIENCE: ['ERFAHREN'],
        IT_SKILLS: ['PROGRAMMIERUNG', 'WEBENTWICKLUNG'],
        IT_BACKGROUND: ['BERUFSERFAHRUNG'],
        INTERESTS: ['CYBERSECURITY'],
      };
      expect(getNextQuestion(answers)).toBeNull();
      expect(isOnboardingComplete(answers)).toBe(true);
    });

    it('ist nach IT_EXPERIENCE=KEINE und INTERESTS abgeschlossen (verkuerzter Pfad)', () => {
      const answers: OnboardingAnswers = {
        IT_EXPERIENCE: ['KEINE'],
        INTERESTS: ['SONSTIGES'],
      };
      expect(getNextQuestion(answers)).toBeNull();
      expect(isOnboardingComplete(answers)).toBe(true);
    });

    it('ist unvollstaendig, solange INTERESTS fehlt', () => {
      const answers: OnboardingAnswers = { IT_EXPERIENCE: ['KEINE'] };
      expect(isOnboardingComplete(answers)).toBe(false);
    });
  });

  describe('validateAnswer', () => {
    it('akzeptiert eine gueltige Einzelauswahl', () => {
      expect(validateAnswer('IT_EXPERIENCE', ['ANFAENGER'])).toEqual(['ANFAENGER']);
    });

    it('akzeptiert eine gueltige Mehrfachauswahl', () => {
      expect(validateAnswer('IT_SKILLS', ['PROGRAMMIERUNG', 'WEBENTWICKLUNG'])).toEqual([
        'PROGRAMMIERUNG',
        'WEBENTWICKLUNG',
      ]);
    });

    it('lehnt zu viele Werte bei einer Einzelauswahl-Frage ab', () => {
      expect(() => validateAnswer('IT_EXPERIENCE', ['ANFAENGER', 'ERFAHREN'])).toThrow(
        ValidationError,
      );
    });

    it('lehnt unbekannte Werte ab', () => {
      expect(() => validateAnswer('IT_EXPERIENCE', ['UNGUELTIGER_WERT'])).toThrow(ValidationError);
    });

    it('lehnt eine leere Auswahl ab', () => {
      expect(() => validateAnswer('IT_EXPERIENCE', [])).toThrow(ValidationError);
    });

    it('lehnt doppelte Werte ab', () => {
      expect(() => validateAnswer('IT_SKILLS', ['PROGRAMMIERUNG', 'PROGRAMMIERUNG'])).toThrow(
        ValidationError,
      );
    });

    it('lehnt zu viele Werte bei IT_BACKGROUND (Einzelauswahl) ab', () => {
      expect(() =>
        validateAnswer('IT_BACKGROUND', ['AUSBILDUNG_STUDIUM', 'BERUFSERFAHRUNG']),
      ).toThrow(ValidationError);
    });

    it('akzeptiert die volle Optionsliste bei INTERESTS', () => {
      const allInterests = [
        'WEBENTWICKLUNG',
        'CYBERSECURITY',
        'DATENANALYSE_KI',
        'ADMINISTRATION_CLOUD',
        'SUPPORT_HELPDESK',
        'SONSTIGES',
      ];
      expect(validateAnswer('INTERESTS', allInterests)).toEqual(allInterests);
    });
  });
});

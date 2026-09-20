import { z, type ZodTypeAny } from 'zod';
import {
  IT_EXPERIENCE_LEVELS,
  IT_EXPERIENCE_LEVEL_LABELS,
  itExperienceLevelSchema,
  IT_SKILLS,
  IT_SKILL_LABELS,
  itSkillSchema,
  IT_BACKGROUNDS,
  IT_BACKGROUND_LABELS,
  itBackgroundSchema,
  INTERESTS,
  INTEREST_LABELS,
  interestSchema,
} from '../types/domain.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Reihenfolge der Onboarding-Fragen. Rein deklarativ - welche Fragen davon
 * tatsaechlich gestellt werden, entscheidet getNextQuestion() dynamisch anhand
 * bereits gegebener Antworten (siehe dort).
 */
export const ONBOARDING_QUESTIONS = [
  'IT_EXPERIENCE',
  'IT_SKILLS',
  'IT_BACKGROUND',
  'INTERESTS',
] as const;
export type OnboardingQuestionKey = (typeof ONBOARDING_QUESTIONS)[number];

/** Bereits gegebene Antworten, pro Frage die Liste der ausgewaehlten Werte. */
export type OnboardingAnswers = Partial<Record<OnboardingQuestionKey, string[]>>;

export interface OnboardingQuestionConfig {
  title: string;
  description: string;
  multiSelect: boolean;
  minValues: number;
  maxValues: number;
  options: readonly string[];
  labels: Record<string, string>;
  valueSchema: ZodTypeAny;
}

export const ONBOARDING_QUESTION_CONFIG: Record<OnboardingQuestionKey, OnboardingQuestionConfig> = {
  IT_EXPERIENCE: {
    title: 'IT-Vorerfahrung',
    description: 'Wie schaetzt du deine bisherige Erfahrung im IT-Bereich ein?',
    multiSelect: false,
    minValues: 1,
    maxValues: 1,
    options: IT_EXPERIENCE_LEVELS,
    labels: IT_EXPERIENCE_LEVEL_LABELS,
    valueSchema: itExperienceLevelSchema,
  },
  IT_SKILLS: {
    title: 'Technische Kenntnisse',
    description:
      'In welchen Bereichen hast du bereits technische Kenntnisse? (Mehrfachauswahl moeglich)',
    multiSelect: true,
    minValues: 1,
    maxValues: IT_SKILLS.length,
    options: IT_SKILLS,
    labels: IT_SKILL_LABELS,
    valueSchema: itSkillSchema,
  },
  IT_BACKGROUND: {
    title: 'Bisherige Taetigkeit',
    description: 'Welche Aussage trifft am ehesten auf deinen bisherigen IT-Bezug zu?',
    multiSelect: false,
    minValues: 1,
    maxValues: 1,
    options: IT_BACKGROUNDS,
    labels: IT_BACKGROUND_LABELS,
    valueSchema: itBackgroundSchema,
  },
  INTERESTS: {
    title: 'Lern- und IT-Interessen',
    description: 'Welche Themen interessieren dich am meisten? (Mehrfachauswahl moeglich)',
    multiSelect: true,
    minValues: 1,
    maxValues: INTERESTS.length,
    options: INTERESTS,
    labels: INTEREST_LABELS,
    valueSchema: interestSchema,
  },
};

/**
 * Fragen, die uebersprungen werden, wenn keinerlei IT-Erfahrung angegeben wurde -
 * es macht keinen Sinn, nach spezifischen technischen Kenntnissen oder
 * IT-bezogener Vorbeschaeftigung zu fragen, wenn die Person selbst angibt,
 * keine IT-Erfahrung zu haben.
 */
const SKIPPED_WHEN_NO_EXPERIENCE: readonly OnboardingQuestionKey[] = ['IT_SKILLS', 'IT_BACKGROUND'];

/**
 * Ermittelt die naechste noch zu stellende Frage anhand der bisher gegebenen
 * Antworten. Gibt `null` zurueck, wenn das Onboarding damit vollstaendig ist.
 * Rein funktional (kein I/O) und damit unabhaengig testbar - der Aufrufer
 * (onboardingService) ist fuer das Laden/Speichern der Antworten zustaendig.
 */
export function getNextQuestion(answers: OnboardingAnswers): OnboardingQuestionKey | null {
  const experience = answers.IT_EXPERIENCE?.[0];

  for (const key of ONBOARDING_QUESTIONS) {
    if (answers[key]) continue;
    if (experience === 'KEINE' && SKIPPED_WHEN_NO_EXPERIENCE.includes(key)) continue;
    return key;
  }

  return null;
}

export function isOnboardingComplete(answers: OnboardingAnswers): boolean {
  return getNextQuestion(answers) === null;
}

/**
 * Validiert die vom Nutzer ausgewaehlten Werte fuer eine Frage (Anzahl im
 * erlaubten Rahmen, jeder Wert eine bekannte Option, keine Duplikate). Wirft
 * ValidationError bei ungueltigen Werten, z. B. bei einer manipulierten oder
 * veralteten Interaktion.
 */
export function validateAnswer(question: OnboardingQuestionKey, values: string[]): string[] {
  const config = ONBOARDING_QUESTION_CONFIG[question];
  const schema = z.array(config.valueSchema).min(config.minValues).max(config.maxValues);
  const result = schema.safeParse(values);

  if (!result.success) {
    throw new ValidationError(
      `Ungueltige Antwort auf die Frage "${config.title}". Bitte starte das Onboarding erneut mit /onboarding.`,
    );
  }

  const uniqueValues = result.data as string[];
  if (new Set(uniqueValues).size !== uniqueValues.length) {
    throw new ValidationError(
      `Die Antwort auf die Frage "${config.title}" enthaelt doppelte Werte.`,
    );
  }

  return uniqueValues;
}

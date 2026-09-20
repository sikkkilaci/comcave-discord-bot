import { z } from 'zod';

/**
 * SQLite unterstuetzt in Prisma keine nativen Enums, daher werden diese
 * Werte als String-Spalten gespeichert. Diese Datei ist die einzige
 * Quelle der Wahrheit fuer die erlaubten Werte und wird sowohl fuer
 * Validierung als auch fuer Typinferenz verwendet.
 */

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  PENDING: 'Ausstehend',
  VERIFIED: 'Verifiziert',
  REJECTED: 'Abgelehnt',
};

export const IT_EXPERIENCE_LEVELS = ['KEINE', 'ANFAENGER', 'FORTGESCHRITTEN', 'ERFAHREN'] as const;
export const itExperienceLevelSchema = z.enum(IT_EXPERIENCE_LEVELS);
export type ItExperienceLevel = z.infer<typeof itExperienceLevelSchema>;

export const IT_EXPERIENCE_LEVEL_LABELS: Record<ItExperienceLevel, string> = {
  KEINE: 'Keine IT-Erfahrung',
  ANFAENGER: 'Anfaenger:in',
  FORTGESCHRITTEN: 'Fortgeschritten',
  ERFAHREN: 'Erfahren',
};

/**
 * Technische Kenntnisse, die im Onboarding als Mehrfachauswahl erfragt werden
 * (nur, wenn ItExperienceLevel != KEINE - siehe src/services/onboardingFlow.ts).
 * Bewusst kategorial statt Freitext, um keine unnoetigen personenbezogenen
 * Details zu erfassen.
 */
export const IT_SKILLS = [
  'PROGRAMMIERUNG',
  'WEBENTWICKLUNG',
  'NETZWERKTECHNIK',
  'SYSTEMADMINISTRATION',
  'DATENBANKEN',
  'KEINE_KENNTNISSE',
] as const;
export const itSkillSchema = z.enum(IT_SKILLS);
export type ItSkill = z.infer<typeof itSkillSchema>;

export const IT_SKILL_LABELS: Record<ItSkill, string> = {
  PROGRAMMIERUNG: 'Programmierung / Softwareentwicklung',
  WEBENTWICKLUNG: 'Webentwicklung',
  NETZWERKTECHNIK: 'Netzwerktechnik',
  SYSTEMADMINISTRATION: 'Systemadministration',
  DATENBANKEN: 'Datenbanken',
  KEINE_KENNTNISSE: 'Noch keine speziellen Kenntnisse',
};

/**
 * Bisherige IT-bezogene Taetigkeit - kategorial statt Freitext, um keine
 * unnoetigen personenbezogenen Details (z. B. Arbeitgeber) zu erfassen.
 */
export const IT_BACKGROUNDS = [
  'AUSBILDUNG_STUDIUM',
  'BERUFSERFAHRUNG',
  'SELBSTSTUDIUM',
  'KEINE_TAETIGKEIT',
] as const;
export const itBackgroundSchema = z.enum(IT_BACKGROUNDS);
export type ItBackground = z.infer<typeof itBackgroundSchema>;

export const IT_BACKGROUND_LABELS: Record<ItBackground, string> = {
  AUSBILDUNG_STUDIUM: 'Ausbildung/Studium mit IT-Bezug',
  BERUFSERFAHRUNG: 'Berufserfahrung im IT-Bereich',
  SELBSTSTUDIUM: 'Selbststudium / Hobby-Projekte',
  KEINE_TAETIGKEIT: 'Keine bisherige Taetigkeit mit IT-Bezug',
};

/** Persoenliche Lern-/IT-Interessen, spaeter Grundlage fuer optionale Interessenrollen. */
export const INTERESTS = [
  'WEBENTWICKLUNG',
  'CYBERSECURITY',
  'DATENANALYSE_KI',
  'ADMINISTRATION_CLOUD',
  'SUPPORT_HELPDESK',
  'SONSTIGES',
] as const;
export const interestSchema = z.enum(INTERESTS);
export type Interest = z.infer<typeof interestSchema>;

export const INTEREST_LABELS: Record<Interest, string> = {
  WEBENTWICKLUNG: 'Webentwicklung',
  CYBERSECURITY: 'Cybersecurity',
  DATENANALYSE_KI: 'Datenanalyse / KI',
  ADMINISTRATION_CLOUD: 'Administration / Cloud',
  SUPPORT_HELPDESK: 'Support / Helpdesk',
  SONSTIGES: 'Sonstiges',
};

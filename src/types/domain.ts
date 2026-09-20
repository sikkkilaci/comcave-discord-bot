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

export const IT_EXPERIENCE_LEVELS = ['KEINE', 'ANFAENGER', 'FORTGESCHRITTEN', 'ERFAHREN'] as const;
export const itExperienceLevelSchema = z.enum(IT_EXPERIENCE_LEVELS);
export type ItExperienceLevel = z.infer<typeof itExperienceLevelSchema>;

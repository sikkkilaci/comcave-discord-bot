import type { Member } from '@prisma/client';
import { getMember, updateMemberProfile } from '../repositories/memberRepository.js';
import { getLatestAnswers, recordAnswer } from '../repositories/onboardingRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  getNextQuestion,
  validateAnswer,
  type OnboardingAnswers,
  type OnboardingQuestionKey,
} from './onboardingFlow.js';
import { PermissionError } from '../utils/errors.js';
import type { ItExperienceLevel } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('onboardingService');

export interface OnboardingState {
  answers: OnboardingAnswers;
  /** Naechste zu stellende Frage, oder null wenn das Onboarding vollstaendig ist. */
  nextQuestion: OnboardingQuestionKey | null;
  complete: boolean;
}

/**
 * Stellt sicher, dass ein Mitglied verifiziert ist, bevor es am Onboarding
 * teilnimmt. Wird sowohl beim Lesen des Zustands als auch beim Beantworten
 * einer Frage geprueft, damit ein zwischenzeitlicher Statuswechsel (z. B.
 * Admin setzt Mitglied zurueck) nicht zu inkonsistenten Daten fuehrt.
 */
export async function assertMemberVerified(guildId: string, discordId: string): Promise<Member> {
  const member = await getMember(guildId, discordId);
  if (!member || member.verificationStatus !== 'VERIFIED') {
    throw new PermissionError(
      'Bitte verifiziere dich zuerst (Button oder /verifizieren), bevor du am Onboarding teilnimmst.',
    );
  }
  return member;
}

/** Liefert den aktuellen Onboarding-Fortschritt eines Mitglieds. */
export async function getOnboardingState(
  guildId: string,
  discordId: string,
): Promise<OnboardingState> {
  const member = await assertMemberVerified(guildId, discordId);
  const answers = await getLatestAnswers(member.id);
  const nextQuestion = getNextQuestion(answers);
  return { answers, nextQuestion, complete: nextQuestion === null };
}

/**
 * Speichert die Antwort auf eine Onboarding-Frage, denormalisiert bei
 * IT_EXPERIENCE/INTERESTS zusaetzlich in die entsprechenden Member-Felder
 * (fuer direkten Zugriff durch kuenftige Rollen-/Klassenlogik, ohne die
 * OnboardingAnswer-Historie parsen zu muessen) und gibt den neuen
 * Gesamtzustand zurueck.
 */
export async function submitAnswer(
  guildId: string,
  discordId: string,
  question: OnboardingQuestionKey,
  rawValues: string[],
): Promise<OnboardingState> {
  const member = await assertMemberVerified(guildId, discordId);
  const values = validateAnswer(question, rawValues);

  await recordAnswer(member.id, question, values);

  if (question === 'IT_EXPERIENCE') {
    await updateMemberProfile(guildId, discordId, {
      itExperienceLevel: values[0] as ItExperienceLevel,
    });
  } else if (question === 'INTERESTS') {
    await updateMemberProfile(guildId, discordId, { interests: JSON.stringify(values) });
  }

  const answers = await getLatestAnswers(member.id);
  const nextQuestion = getNextQuestion(answers);
  const complete = nextQuestion === null;

  if (complete) {
    await logAuditEvent({
      guildId,
      actorDiscordId: discordId,
      action: 'member.onboarding_complete',
      targetDiscordId: discordId,
    });
    logger.info({ guildId, member: discordId }, 'Onboarding abgeschlossen');
  }

  return { answers, nextQuestion, complete };
}

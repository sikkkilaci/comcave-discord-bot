import { updateMemberProfile } from '../repositories/memberRepository.js';
import { getLatestAnswers, recordAnswer } from '../repositories/onboardingRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  getNextQuestion,
  validateAnswer,
  type OnboardingAnswers,
  type OnboardingQuestionKey,
} from './onboardingFlow.js';
import { assertMemberVerified } from './verificationService.js';
import { assertProfileComplete } from './memberProfileService.js';
import { assertRulesAccepted } from './ruleService.js';
import type { ItExperienceLevel } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('onboardingService');

/** Re-exportiert fuer Rueckwaertskompatibilitaet - kanonisch definiert in verificationService.ts. */
export { assertMemberVerified };

export interface OnboardingState {
  answers: OnboardingAnswers;
  /** Naechste zu stellende Frage, oder null wenn das Onboarding vollstaendig ist. */
  nextQuestion: OnboardingQuestionKey | null;
  complete: boolean;
}

/** Liefert den aktuellen Onboarding-Fortschritt eines Mitglieds. */
export async function getOnboardingState(
  guildId: string,
  discordId: string,
): Promise<OnboardingState> {
  const member = await assertMemberVerified(guildId, discordId);
  await assertProfileComplete(guildId, discordId);
  await assertRulesAccepted(guildId, discordId);
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
  await assertProfileComplete(guildId, discordId);
  await assertRulesAccepted(guildId, discordId);
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

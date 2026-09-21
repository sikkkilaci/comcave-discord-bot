import { getMember } from '../repositories/memberRepository.js';
import { getLatestAnswers } from '../repositories/onboardingRepository.js';
import { isOnboardingComplete } from './onboardingFlow.js';
import { hasAcceptedCurrentRules } from './ruleService.js';

/**
 * Alle Schritte des Eintrittsflows in ihrer verbindlichen Reihenfolge (siehe
 * Architektur-Analyse "Regelwerk + Regelzustimmung"): Verifizierung ->
 * persoenliche Angaben -> COMCAVE-Standort -> Regelzustimmung -> bestehendes
 * Onboarding -> Klassenwahl. `resolveNextJourneyStep()` ist die EINZIGE
 * Stelle, die diese Reihenfolge kennt - alle Aufrufer (interactionCreate.ts
 * nach Verify-Klick, nach Standortwahl, nach Regelzustimmung) fragen hier
 * nach, statt die Reihenfolge selbst zu duplizieren.
 */
export const JOURNEY_STEPS = [
  'NEEDS_VERIFICATION',
  'NEEDS_PROFILE_DETAILS',
  'NEEDS_LOCATION',
  'NEEDS_RULES_ACCEPTANCE',
  'NEEDS_ONBOARDING',
  'COMPLETE',
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/**
 * Ermittelt rein lesend (keine Nebenwirkungen), welcher Schritt fuer ein
 * Mitglied als naechstes ansteht. Prueft dieselben Bedingungen wie
 * assertMemberVerified()/assertProfileComplete()/assertRulesAccepted(), aber
 * ohne zu werfen - Grundlage fuer die UI-Anzeige (siehe journeyMessage.ts),
 * die eigentliche Zugriffskontrolle bleibt bei den werfenden Assert-
 * Funktionen in den jeweiligen Services.
 */
export async function resolveNextJourneyStep(
  guildId: string,
  discordId: string,
): Promise<JourneyStep> {
  const member = await getMember(guildId, discordId);
  if (!member || member.verificationStatus !== 'VERIFIED') {
    return 'NEEDS_VERIFICATION';
  }

  if (!member.firstName || !member.lastName || member.age === null) {
    return 'NEEDS_PROFILE_DETAILS';
  }

  if (!member.locationId || !member.profileCompletedAt) {
    return 'NEEDS_LOCATION';
  }

  const rulesAccepted = await hasAcceptedCurrentRules(guildId, discordId);
  if (!rulesAccepted) {
    return 'NEEDS_RULES_ACCEPTANCE';
  }

  const answers = await getLatestAnswers(member.id);
  if (!isOnboardingComplete(answers)) {
    return 'NEEDS_ONBOARDING';
  }

  return 'COMPLETE';
}

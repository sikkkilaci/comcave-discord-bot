import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getMember } from '../repositories/memberRepository.js';
import { getLatestAnswers } from '../repositories/onboardingRepository.js';
import { isOnboardingComplete } from './onboardingFlow.js';
import { hasAcceptedCurrentRules } from './ruleService.js';
import { addRoleOrThrow } from './discordRoleSync.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('memberJourneyService');

/**
 * Alle Schritte des Eintrittsflows in ihrer verbindlichen Reihenfolge:
 * Verifizierung -> persoenliche Angaben -> COMCAVE-Standort -> Fachrichtung
 * -> Klassenwahl -> bestehendes Onboarding -> Regelzustimmung. Regelzustimmung
 * ist bewusst der LETZTE Schritt (nicht wie fruehers vor Klassenwahl/
 * Onboarding) - erst danach gilt ein Mitglied als vollstaendig onboarded und
 * bekommt die eigentliche Server-Sichtbarkeit (siehe
 * grantOnboardedRoleIfComplete() unten). `resolveNextJourneyStep()` ist die
 * EINZIGE Stelle, die diese Reihenfolge kennt - alle Aufrufer fragen hier
 * nach, statt die Reihenfolge selbst zu duplizieren.
 */
export const JOURNEY_STEPS = [
  'NEEDS_VERIFICATION',
  'NEEDS_PROFILE_DETAILS',
  'NEEDS_LOCATION',
  'NEEDS_FACHRICHTUNG',
  'NEEDS_CLASS',
  'NEEDS_ONBOARDING',
  'NEEDS_RULES_ACCEPTANCE',
  'COMPLETE',
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/**
 * Ermittelt rein lesend (keine Nebenwirkungen), welcher Schritt fuer ein
 * Mitglied als naechstes ansteht. Prueft dieselben Bedingungen wie die
 * werfenden Assert-Funktionen der jeweiligen Services, aber ohne zu werfen -
 * Grundlage fuer die UI-Anzeige (siehe journeyFlow.ts), die eigentliche
 * Zugriffskontrolle bleibt bei den Assert-Funktionen selbst.
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

  if (!member.fachrichtung) {
    return 'NEEDS_FACHRICHTUNG';
  }

  if (!member.classId) {
    return 'NEEDS_CLASS';
  }

  const answers = await getLatestAnswers(member.id);
  if (!isOnboardingComplete(answers)) {
    return 'NEEDS_ONBOARDING';
  }

  const rulesAccepted = await hasAcceptedCurrentRules(guildId, discordId);
  if (!rulesAccepted) {
    return 'NEEDS_RULES_ACCEPTANCE';
  }

  return 'COMPLETE';
}

/**
 * Vergibt die "vollstaendig onboarded"-Rolle (siehe
 * globalServerStructureService.ts, die diese Rolle statt der reinen
 * Verifiziert-Rolle fuer die eigentliche Kanalsichtbarkeit verwendet), sobald
 * ein Mitglied den GESAMTEN Eintrittsflow abgeschlossen hat. Wird genau
 * einmal aufgerufen, direkt nach der Regelzustimmung (dem letzten Schritt,
 * siehe interactionCreate.ts) - idempotent (Discord ignoriert das erneute
 * Vergeben einer bereits vorhandenen Rolle), daher unschaedlich bei
 * mehrfachem Aufruf. Ein Fehlschlag (z. B. fehlende Bot-Berechtigung) wird
 * geloggt statt den Abschluss des Eintrittsflows zu blockieren - dieselbe
 * "Komfortfunktion darf den Kernablauf nicht sprengen"-Haltung wie beim
 * Nickname-Setzen in memberProfileService.ts.
 */
export async function grantOnboardedRoleIfComplete(
  targetMember: GuildMember,
  guildConfig: GuildConfig,
  actorDiscordId: string,
): Promise<void> {
  if (!guildConfig.onboardedRoleId) return;

  try {
    const step = await resolveNextJourneyStep(guildConfig.id, targetMember.id);
    if (step !== 'COMPLETE') return;
    if (targetMember.roles.cache.has(guildConfig.onboardedRoleId)) return;

    await addRoleOrThrow(
      targetMember,
      guildConfig.onboardedRoleId,
      'Eintrittsflow vollstaendig abgeschlossen',
    );

    await logAuditEvent({
      guildId: guildConfig.id,
      actorDiscordId,
      action: 'member.onboarding_gate_passed',
      targetDiscordId: targetMember.id,
    });

    logger.info(
      { guildId: guildConfig.id, member: targetMember.id },
      'Eintrittsflow abgeschlossen - Mitglied-Rolle vergeben',
    );
  } catch (error) {
    logger.warn(
      { err: error, guildId: guildConfig.id, member: targetMember.id },
      'Konnte Mitglied-Rolle nach Abschluss des Eintrittsflows nicht vergeben',
    );
  }
}

import type { Member } from '@prisma/client';
import { getMember, setMemberFachrichtung } from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { assertMemberVerified } from './verificationService.js';
import { assertProfileComplete } from './memberProfileService.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import type { Fachrichtung } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('fachrichtungService');

export interface FachrichtungChoiceResult {
  member: Member;
  fachrichtung: Fachrichtung;
  /** false, wenn das Mitglied bereits genau diese Fachrichtung hatte. */
  changed: boolean;
}

/**
 * Legt die Fachrichtung eines Mitglieds EINMALIG fest (Schritt im
 * Eintrittsflow nach dem Standort, vor der Klassenwahl - siehe
 * memberJourneyService.ts). Anders als bei der Klassenwahl gibt es hierfuer
 * (noch) keinen Admin-Override-Befehl, da eine falsche Fachrichtungswahl in
 * der Praxis seltener vorkommt als ein Klassenwechsel-Wunsch; im Bedarfsfall
 * kann ein Admin den Wert direkt in der Datenbank korrigieren.
 *
 * Wirft PermissionError, wenn das Mitglied nicht verifiziert ist oder das
 * Profil noch nicht vollstaendig ist, und ValidationError, wenn bereits eine
 * (ggf. andere) Fachrichtung gesetzt ist.
 */
export async function chooseFachrichtung(
  guildId: string,
  discordId: string,
  fachrichtung: Fachrichtung,
  actorDiscordId: string,
): Promise<FachrichtungChoiceResult> {
  await assertMemberVerified(guildId, discordId);
  await assertProfileComplete(guildId, discordId);

  const memberRow = await getMember(guildId, discordId);
  if (!memberRow) {
    // Unerreichbar: assertMemberVerified() oben hat den Member-Datensatz bereits gefunden.
    throw new ValidationError('Mitglied konnte nicht gefunden werden.');
  }

  if (memberRow.fachrichtung) {
    if (memberRow.fachrichtung === fachrichtung) {
      return { member: memberRow, fachrichtung, changed: false };
    }
    throw new ValidationError(
      'Deine Fachrichtung ist bereits festgelegt und kann nicht selbst geaendert werden. ' +
        'Bitte wende dich an die Verwaltung, falls hier ein Fehler vorliegt.',
    );
  }

  const updated = await setMemberFachrichtung(guildId, discordId, fachrichtung);

  await logAuditEvent({
    guildId,
    actorDiscordId,
    action: 'member.fachrichtung_set',
    targetDiscordId: discordId,
    metadata: { fachrichtung },
  });

  logger.info({ guildId, member: discordId, fachrichtung }, 'Fachrichtung festgelegt');

  return { member: updated, fachrichtung, changed: true };
}

/**
 * Zentraler Guard: stellt sicher, dass ein Mitglied bereits eine Fachrichtung
 * gewaehlt hat, bevor es an nachgelagerten Schritten (Klassenwahl,
 * Onboarding-Fragebogen, Regelzustimmung) teilnimmt - gleiches Prinzip wie
 * assertProfileComplete()/assertRulesAccepted().
 */
export async function assertFachrichtungChosen(
  guildId: string,
  discordId: string,
): Promise<Member> {
  const member = await getMember(guildId, discordId);
  if (!member || !member.fachrichtung) {
    throw new PermissionError('Bitte waehle zuerst deine Fachrichtung.');
  }
  return member;
}

import type { GuildConfig, RuleSet } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { createNewActiveRuleSet, getActiveRuleSet } from '../repositories/ruleSetRepository.js';
import {
  acceptRules as acceptRulesRow,
  getAcceptance,
  listAcceptancesForRuleSet,
  recordShown,
} from '../repositories/ruleAcceptanceRepository.js';
import { countVerifiedMembers } from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { PermissionError, ValidationError } from '../utils/errors.js';

const NOT_CONFIGURED_MESSAGE =
  'Es ist noch kein Regelwerk konfiguriert. Ein Admin muss zuerst /regelwerk-aktualisieren ausfuehren.';

export const RULE_CONTENT_MAX_LENGTH = 4000;

/** Liefert die aktuell aktive Regelwerk-Version einer Guild, fuer /regeln (rein lesend, jederzeit fuer alle). */
export async function getCurrentRuleSet(guildId: string): Promise<RuleSet | null> {
  return getActiveRuleSet(guildId);
}

/**
 * Legt eine neue, aktive Regelwerk-Version an (ADMIN-only). Da nie eine
 * bestehende Version veraendert wird (siehe createNewActiveRuleSet()),
 * verliert eine bereits erteilte Zustimmung zur alten Version nie ihre
 * historische Gueltigkeit - sie bezieht sich weiterhin nachvollziehbar auf
 * genau die damalige Version. Fuer die NEUE Version existiert zwangslaeufig
 * noch keine Zustimmung, wodurch assertRulesAccepted() automatisch eine
 * erneute Zustimmung einfordert, ohne dass hier zusaetzlich etwas
 * zurueckgesetzt werden muesste.
 */
export async function updateRules(
  guildConfig: GuildConfig,
  member: GuildMember,
  content: string,
  actorDiscordId: string,
): Promise<RuleSet> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen das Regelwerk aktualisieren.');
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new ValidationError('Der Regeltext darf nicht leer sein.');
  }
  if (trimmed.length > RULE_CONTENT_MAX_LENGTH) {
    throw new ValidationError(
      `Der Regeltext darf hoechstens ${RULE_CONTENT_MAX_LENGTH} Zeichen lang sein.`,
    );
  }

  const ruleSet = await createNewActiveRuleSet(guildConfig.id, trimmed, actorDiscordId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'rules.version_created',
    metadata: { version: ruleSet.version },
  });

  return ruleSet;
}

/**
 * Zeigt einem Mitglied die aktuelle Regelversion (vermerkt `shownAt`) - wird
 * aufgerufen, sobald der Eintrittsflow diesen Schritt tatsaechlich anzeigt.
 * Wirft ValidationError, wenn noch kein Regelwerk konfiguriert ist (Admin
 * muss zuerst /regelwerk-aktualisieren ausfuehren, analog zu anderen
 * "noch nicht konfiguriert"-Faellen im Projekt).
 */
export async function showRulesToMember(guildId: string, discordId: string): Promise<RuleSet> {
  const ruleSet = await getActiveRuleSet(guildId);
  if (!ruleSet) {
    throw new ValidationError(NOT_CONFIGURED_MESSAGE);
  }

  await recordShown(guildId, discordId, ruleSet.id);
  return ruleSet;
}

/**
 * Bestaetigt die Zustimmung eines Mitglieds zur aktuell aktiven
 * Regelversion. Die Version wird immer serverseitig aufgeloest
 * (getActiveRuleSet()), nie einem Aufrufer-Parameter vertraut - eine
 * manipulierte/veraltete RuleSet-ID kann daher nie eine Zustimmung zu einer
 * bereits abgeloesten Version vortaeuschen.
 */
export async function acceptCurrentRules(
  guildConfig: GuildConfig,
  member: GuildMember,
  actorDiscordId: string,
): Promise<RuleSet> {
  const ruleSet = await getActiveRuleSet(guildConfig.id);
  if (!ruleSet) {
    throw new ValidationError(NOT_CONFIGURED_MESSAGE);
  }

  const { created } = await acceptRulesRow(guildConfig.id, member.id, ruleSet.id);

  if (created) {
    await logAuditEvent({
      guildId: guildConfig.id,
      actorDiscordId,
      action: 'rules.accepted',
      targetDiscordId: member.id,
      metadata: { version: ruleSet.version },
    });
  }

  return ruleSet;
}

/**
 * Zentraler Guard: stellt sicher, dass ein Mitglied der AKTUELLEN
 * Regelversion bereits zugestimmt hat, bevor es an Onboarding/Klassenwahl
 * teilnimmt. Wird bei jedem Zugriff frisch geprueft (wie
 * assertMemberVerified()/assertProfileComplete()) - nach einem Regelwerk-
 * Update greift dieser Guard automatisch erneut, da fuer die neue Version
 * noch keine Zustimmung existiert.
 */
export async function assertRulesAccepted(guildId: string, discordId: string): Promise<void> {
  const ruleSet = await getActiveRuleSet(guildId);
  if (!ruleSet) {
    throw new ValidationError(NOT_CONFIGURED_MESSAGE);
  }

  const acceptance = await getAcceptance(discordId, ruleSet.id);
  if (!acceptance?.acceptedAt) {
    throw new PermissionError('Bitte stimme zuerst den aktuellen Serverregeln zu.');
  }
}

/**
 * Nicht werfende Variante von assertRulesAccepted() - liefert schlicht
 * `false`, wenn noch kein Regelwerk konfiguriert ist ODER das Mitglied der
 * aktuellen Version noch nicht zugestimmt hat. Wird von
 * memberJourneyService.resolveNextJourneyStep() verwendet, das den naechsten
 * Schritt anhand von Zustaenden statt per Exception-Steuerung ermittelt.
 */
export async function hasAcceptedCurrentRules(
  guildId: string,
  discordId: string,
): Promise<boolean> {
  const ruleSet = await getActiveRuleSet(guildId);
  if (!ruleSet) return false;

  const acceptance = await getAcceptance(discordId, ruleSet.id);
  return Boolean(acceptance?.acceptedAt);
}

export interface RuleAcceptanceStatus {
  ruleSet: RuleSet;
  acceptedCount: number;
  totalVerifiedMembers: number;
}

/** Zustimmungsuebersicht zur aktuellen Version fuer /regelwerk-status (ADMIN-only). */
export async function getRuleAcceptanceStatus(
  guildConfig: GuildConfig,
  member: GuildMember,
): Promise<RuleAcceptanceStatus> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen den Regelwerk-Status einsehen.');
  }

  const ruleSet = await getActiveRuleSet(guildConfig.id);
  if (!ruleSet) {
    throw new ValidationError(NOT_CONFIGURED_MESSAGE);
  }

  const [acceptances, totalVerifiedMembers] = await Promise.all([
    listAcceptancesForRuleSet(ruleSet.id),
    countVerifiedMembers(guildConfig.id),
  ]);

  return { ruleSet, acceptedCount: acceptances.length, totalVerifiedMembers };
}

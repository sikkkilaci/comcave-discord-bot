import type { RuleAcceptance } from '@prisma/client';
import { isUniqueConstraintError, prisma } from '../db/client.js';

export async function getAcceptance(
  memberDiscordId: string,
  ruleSetId: string,
): Promise<RuleAcceptance | null> {
  return prisma.ruleAcceptance.findUnique({
    where: { memberDiscordId_ruleSetId: { memberDiscordId, ruleSetId } },
  });
}

/**
 * Merkt sich, dass einem Mitglied die aktuelle Regelversion angezeigt wurde
 * (`shownAt`). Idempotent per Unique-Constraint - ein wiederholter Aufruf
 * (z. B. erneuter Blick auf /regeln vor der Zustimmung) erzeugt keinen
 * zweiten Eintrag und ueberschreibt `shownAt` nicht erneut.
 */
export async function recordShown(
  guildId: string,
  memberDiscordId: string,
  ruleSetId: string,
): Promise<RuleAcceptance> {
  const existing = await getAcceptance(memberDiscordId, ruleSetId);
  if (existing) return existing;

  try {
    return await prisma.ruleAcceptance.create({ data: { guildId, memberDiscordId, ruleSetId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await getAcceptance(memberDiscordId, ruleSetId);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Bestaetigt Zustimmung zu einer Regelversion. Eindeutig pro Mitglied+Version
 * (`@@unique`) - ein erneuter Zustimmungs-Klick erzeugt nie einen zweiten
 * Eintrag, sondern liefert idempotent den bereits bestaetigten Datensatz
 * zurueck (`acceptedAt` bleibt beim ersten Zeitpunkt). Faengt zusaetzlich die
 * Race Condition zweier nahezu gleichzeitiger Klicks ab (siehe
 * coursePlanRepository.ts/studyGroupRepository.ts fuer dasselbe Muster).
 */
export async function acceptRules(
  guildId: string,
  memberDiscordId: string,
  ruleSetId: string,
): Promise<{ acceptance: RuleAcceptance; created: boolean }> {
  const existing = await getAcceptance(memberDiscordId, ruleSetId);
  if (existing?.acceptedAt) {
    return { acceptance: existing, created: false };
  }
  if (existing) {
    const updated = await prisma.ruleAcceptance.update({
      where: { memberDiscordId_ruleSetId: { memberDiscordId, ruleSetId } },
      data: { acceptedAt: new Date() },
    });
    return { acceptance: updated, created: false };
  }

  try {
    const created = await prisma.ruleAcceptance.create({
      data: { guildId, memberDiscordId, ruleSetId, acceptedAt: new Date() },
    });
    return { acceptance: created, created: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await getAcceptance(memberDiscordId, ruleSetId);
      if (raced) {
        if (raced.acceptedAt) return { acceptance: raced, created: false };
        const updated = await prisma.ruleAcceptance.update({
          where: { memberDiscordId_ruleSetId: { memberDiscordId, ruleSetId } },
          data: { acceptedAt: new Date() },
        });
        return { acceptance: updated, created: false };
      }
    }
    throw error;
  }
}

/** Nur tatsaechlich bestaetigte Zustimmungen (nicht nur "angezeigt") - fuer /regelwerk-status. */
export async function listAcceptancesForRuleSet(ruleSetId: string): Promise<RuleAcceptance[]> {
  return prisma.ruleAcceptance.findMany({ where: { ruleSetId, acceptedAt: { not: null } } });
}

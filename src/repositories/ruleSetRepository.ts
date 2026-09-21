import type { RuleSet } from '@prisma/client';
import { prisma } from '../db/client.js';

/** Liefert die aktuell aktive Regelwerk-Version einer Guild (oder null, falls noch keine konfiguriert ist). */
export async function getActiveRuleSet(guildId: string): Promise<RuleSet | null> {
  return prisma.ruleSet.findFirst({ where: { guildId, isActive: true } });
}

/** Immer nach `guildId` gescoped, damit eine RuleSet-ID nie serveruebergreifend Daten preisgibt. */
export async function getRuleSetById(guildId: string, ruleSetId: string): Promise<RuleSet | null> {
  return prisma.ruleSet.findFirst({ where: { id: ruleSetId, guildId } });
}

/**
 * Legt eine neue, aktive Regelwerk-Version an und deaktiviert dabei atomar
 * die zuvor aktive Version (falls vorhanden) - beides in einer Transaktion,
 * damit zu keinem Zeitpunkt zwei aktive Versionen gleichzeitig existieren.
 * Eine bestehende Version wird NIE in-place veraendert (siehe Kommentar am
 * Modell in schema.prisma) - jede Aktualisierung ist eine neue Zeile mit
 * fortlaufender Versionsnummer.
 */
export async function createNewActiveRuleSet(
  guildId: string,
  content: string,
  createdByDiscordId: string,
): Promise<RuleSet> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.ruleSet.findFirst({ where: { guildId, isActive: true } });
    if (current) {
      await tx.ruleSet.update({ where: { id: current.id }, data: { isActive: false } });
    }

    const nextVersion = (current?.version ?? 0) + 1;
    return tx.ruleSet.create({
      data: { guildId, version: nextVersion, content, createdByDiscordId, isActive: true },
    });
  });
}

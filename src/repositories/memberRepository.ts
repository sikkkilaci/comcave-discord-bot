import type { Member } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { VerificationStatus } from '../types/domain.js';

/**
 * Liefert den Member-Datensatz eines Discord-Nutzers auf einem Server und
 * legt bei Bedarf einen neuen mit Status PENDING an (z. B. beim Server-Beitritt
 * oder bei der ersten Interaktion mit einem Verifizierungs-Befehl).
 */
export async function getOrCreateMember(guildId: string, discordId: string): Promise<Member> {
  return prisma.member.upsert({
    where: { guildId_discordId: { guildId, discordId } },
    update: {},
    create: { guildId, discordId },
  });
}

export async function getMember(guildId: string, discordId: string): Promise<Member | null> {
  return prisma.member.findUnique({
    where: { guildId_discordId: { guildId, discordId } },
  });
}

/**
 * Setzt den Verifizierungsstatus eines Mitglieds. `verifiedAt` wird beim
 * Wechsel zu VERIFIED gesetzt und bei jedem anderen Status zurueckgesetzt,
 * damit es immer den Zeitpunkt der zuletzt *aktiven* Verifizierung abbildet.
 */
export async function setVerificationStatus(
  guildId: string,
  discordId: string,
  status: VerificationStatus,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data: {
      verificationStatus: status,
      verifiedAt: status === 'VERIFIED' ? new Date() : null,
    },
  });
}

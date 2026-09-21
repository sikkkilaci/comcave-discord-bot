import type { GuildConfig } from '@prisma/client';
import { prisma } from '../db/client.js';

/**
 * Liefert die Konfiguration eines Servers und legt bei Bedarf einen leeren
 * Eintrag an. So kann der Bot ohne manuelle Ersteinrichtung starten und
 * Rollen-/Kanal-IDs werden erst konfiguriert, sobald sie gebraucht werden.
 */
export async function getOrCreateGuildConfig(guildId: string): Promise<GuildConfig> {
  return prisma.guildConfig.upsert({
    where: { id: guildId },
    update: {},
    create: { id: guildId },
  });
}

export async function updateGuildConfig(
  guildId: string,
  data: Partial<
    Pick<
      GuildConfig,
      | 'adminRoleId'
      | 'moderatorRoleId'
      | 'verifiedRoleId'
      | 'onboardedRoleId'
      | 'logChannelId'
      | 'welcomeChannelId'
      | 'whereAmIChannelId'
    >
  >,
): Promise<GuildConfig> {
  await getOrCreateGuildConfig(guildId);
  return prisma.guildConfig.update({
    where: { id: guildId },
    data,
  });
}

import { ChannelType, DiscordAPIError, type Guild } from 'discord.js';
import {
  ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID,
  ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID,
  ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX,
  buildAdminPanelMessage,
} from '../bot/ui/adminPanelMessage.js';
import { ValidationError } from '../utils/errors.js';

/** Siehe globalServerStructureService.ts, Kategorie "08 · INTERN". */
const ADMIN_CHANNEL_NAME = '⚙️-verwaltung';

/** Discord-API-Fehlercode fuer "Missing Permissions". */
const DISCORD_MISSING_PERMISSIONS = 50013;

function isAdminPanelCustomId(customId: string): boolean {
  return (
    customId.startsWith(ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX) ||
    customId === ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID ||
    customId === ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID
  );
}

export interface PostAdminPanelResult {
  posted: boolean;
  channelId: string;
}

/**
 * Postet das dauerhafte Admin-Panel (siehe adminPanelMessage.ts) in den
 * internen `⚙️-verwaltung`-Kanal - idempotent per Button-customId-Abgleich
 * der letzten 20 Nachrichten (dasselbe Muster wie ensureBotMessage() in
 * serverBootstrapService.ts fuer Verifizierung/#wo-bin-ich), damit ein
 * erneuter Aufruf keine zweite Panel-Nachricht erzeugt.
 *
 * Wirft ValidationError, wenn der Kanal noch nicht existiert (siehe
 * /setup-server) oder wenn dem Bot die Berechtigung zum Senden fehlt.
 */
export async function postAdminPanel(guild: Guild): Promise<PostAdminPanelResult> {
  const channel = await findAdminChannel(guild);
  if (!channel) {
    throw new ValidationError(
      `Der Kanal "${ADMIN_CHANNEL_NAME}" existiert noch nicht. Bitte zuerst /setup-server ausführen.`,
    );
  }

  const alreadyPosted = await channelHasAdminPanel(channel);
  if (alreadyPosted) {
    return { posted: false, channelId: channel.id };
  }

  try {
    await channel.send(buildAdminPanelMessage());
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        `Mir fehlt die Berechtigung, eine Nachricht in ${channel} zu senden. ` +
          'Bitte pruefe meine Kanal-Berechtigungen (Nachrichten senden, Embeds einbetten).',
      );
    }
    throw error;
  }

  return { posted: true, channelId: channel.id };
}

async function findAdminChannel(guild: Guild) {
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (channel && channel.type === ChannelType.GuildText && channel.name === ADMIN_CHANNEL_NAME) {
      return channel;
    }
  }
  return null;
}

async function channelHasAdminPanel(
  channel: Awaited<ReturnType<typeof findAdminChannel>>,
): Promise<boolean> {
  if (!channel) return false;
  let recentMessages;
  try {
    recentMessages = await channel.messages.fetch({ limit: 20 });
  } catch {
    return false;
  }

  for (const message of recentMessages.values()) {
    for (const row of message.components ?? []) {
      for (const component of (row as { components?: Array<{ customId?: string | null }> })
        .components ?? []) {
        if (component.customId && isAdminPanelCustomId(component.customId)) return true;
      }
    }
  }
  return false;
}

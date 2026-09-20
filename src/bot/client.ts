import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import type { BotClient } from '../types/client.js';
import { loadCommands } from './handlers/commandLoader.js';
import { loadEvents } from './handlers/eventLoader.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('client');

/**
 * Intents/Partials sind bewusst minimal gehalten und werden erweitert, sobald
 * die jeweiligen Kernfunktionen (z. B. Verifizierung ueber Reaktionen,
 * Voice-Lerngruppen) das benoetigen.
 */
export function createClient(): BotClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
  }) as BotClient;

  client.commands = new Collection();

  return client;
}

export async function bootstrapClient(client: BotClient): Promise<void> {
  client.commands = await loadCommands();
  await loadEvents(client);
  logger.info('Bot-Client initialisiert');
}

import { REST, Routes } from 'discord.js';
import { env } from '../../config/env.js';
import { loadCommands } from './commandLoader.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('deployCommands');

async function deploy(): Promise<void> {
  const commands = await loadCommands();
  const body = commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(env.DISCORD_TOKEN);

  if (env.DISCORD_DEV_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID),
      { body },
    );
    logger.info(
      { count: body.length, guildId: env.DISCORD_DEV_GUILD_ID },
      'Slash-Commands fuer Entwicklungs-Server registriert (sofort verfuegbar).',
    );
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    logger.info(
      { count: body.length },
      'Slash-Commands global registriert (Verfuegbarkeit kann bis zu 1h dauern).',
    );
  }
}

deploy().catch((error: unknown) => {
  logger.error({ err: error }, 'Registrieren der Slash-Commands fehlgeschlagen.');
  process.exit(1);
});

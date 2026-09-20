import { env } from './config/env.js';
import { createClient, bootstrapClient } from './bot/client.js';
import { disconnectDatabase } from './db/client.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const client = createClient();
  await bootstrapClient(client);

  registerShutdownHandlers(client);

  await client.login(env.DISCORD_TOKEN);
}

function registerShutdownHandlers(client: ReturnType<typeof createClient>): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Bot faehrt herunter...');

    void (async () => {
      try {
        client.destroy();
        await disconnectDatabase();
        logger.info('Bot sauber heruntergefahren.');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Fehler beim Herunterfahren');
        process.exit(1);
      }
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unbehandelte Promise-Ablehnung');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Unbehandelte Ausnahme, Bot wird beendet.');
    shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Bot konnte nicht gestartet werden.');
  process.exit(1);
});

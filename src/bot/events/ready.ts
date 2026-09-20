import type { Client } from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:ready');

const event: BotEvent<'ready'> = {
  name: 'ready',
  once: true,
  execute(client: Client<true>) {
    logger.info(
      { tag: client.user.tag, guilds: client.guilds.cache.size },
      'Bot ist online und bereit.',
    );
  },
};

export default event;

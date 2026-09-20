import type { BotEvent } from '../../types/event.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:error');

const event: BotEvent<'error'> = {
  name: 'error',
  execute(error: Error) {
    logger.error({ err: error }, 'Discord-Client-Fehler');
  },
};

export default event;

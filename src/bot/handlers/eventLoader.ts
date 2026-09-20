import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BotEvent } from '../../types/event.js';
import type { BotClient } from '../../types/client.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('eventLoader');
const eventsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'events');

export async function loadEvents(client: BotClient): Promise<void> {
  const files = await findEventFiles(eventsDir);
  let count = 0;

  for (const file of files) {
    const imported = (await import(pathToFileURL(file).href)) as { default?: unknown };

    if (!isEvent(imported.default)) {
      logger.warn({ file }, 'Datei exportiert kein gueltiges Event, wird uebersprungen.');
      continue;
    }

    const event = imported.default;
    if (event.once) {
      client.once(event.name, (...args) => void event.execute(...args));
    } else {
      client.on(event.name, (...args) => void event.execute(...args));
    }
    count += 1;
    logger.debug({ event: event.name }, 'Event registriert');
  }

  logger.info({ count }, 'Events registriert');
}

async function findEventFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) &&
        !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function isEvent(value: unknown): value is BotEvent {
  return typeof value === 'object' && value !== null && 'name' in value && 'execute' in value;
}

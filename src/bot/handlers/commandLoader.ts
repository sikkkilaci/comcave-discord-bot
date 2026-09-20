import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import type { Command } from '../../types/command.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('commandLoader');
const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands');

export async function loadCommands(): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const files = await findCommandFiles(commandsDir);

  for (const file of files) {
    const imported = (await import(pathToFileURL(file).href)) as { default?: unknown };

    if (!isCommand(imported.default)) {
      logger.warn({ file }, 'Datei exportiert keinen gueltigen Command, wird uebersprungen.');
      continue;
    }

    const command = imported.default;
    commands.set(command.data.name, command);
    logger.debug({ command: command.data.name }, 'Command geladen');
  }

  logger.info({ count: commands.size }, 'Commands geladen');
  return commands;
}

async function findCommandFiles(dir: string): Promise<string[]> {
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

function isCommand(value: unknown): value is Command {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'execute' in value &&
    'permissionLevel' in value
  );
}

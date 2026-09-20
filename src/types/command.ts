import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { PermissionLevel } from '../permissions/PermissionLevel.js';

export interface SlashCommandData {
  name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface Command {
  data: SlashCommandData;
  /** Minimal benoetigte Berechtigungsstufe, wird vom Command-Handler geprueft. */
  permissionLevel: PermissionLevel;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

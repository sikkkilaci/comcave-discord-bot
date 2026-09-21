import type {
  AutocompleteInteraction,
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
  /**
   * Optionaler Autocomplete-Handler fuer Command-Optionen mit
   * `.setAutocomplete(true)` (siehe /standort-waehlen). Wird NICHT ueber
   * hasPermissionLevel() abgesichert (Discord liefert hierfuer keine
   * eigenstaendige Interaktion, auf die eine Ablehnung sinnvoll antworten
   * koennte) - Commands mit Autocomplete duerfen daher in ihrem Handler
   * ausschliesslich unkritische, bereits oeffentliche Vorschlagsdaten liefern.
   */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

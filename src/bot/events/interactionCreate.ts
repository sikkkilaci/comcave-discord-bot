import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import type { BotClient } from '../../types/client.js';
import { getOrCreateGuildConfig } from '../../repositories/guildConfigRepository.js';
import { hasPermissionLevel } from '../../permissions/checkPermission.js';
import { AppError } from '../../utils/errors.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:interactionCreate');

const event: BotEvent<'interactionCreate'> = {
  name: 'interactionCreate',
  async execute(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Dieser Bot kann nur innerhalb des COMCAVE-Servers verwendet werden.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const client = interaction.client as BotClient;
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn({ command: interaction.commandName }, 'Unbekannter Befehl aufgerufen');
      await interaction.reply({
        content: 'Dieser Befehl ist aktuell nicht verfuegbar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
      const member = interaction.member as GuildMember;
      const allowed = await hasPermissionLevel(member, guildConfig, command.permissionLevel);

      if (!allowed) {
        await interaction.reply({
          content: 'Du hast keine Berechtigung, diesen Befehl zu verwenden.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await command.execute(interaction);
    } catch (error) {
      await handleCommandError(interaction, error);
    }
  },
};

async function handleCommandError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> {
  const isKnownError = error instanceof AppError;

  logger.error(
    { err: error, command: interaction.commandName, user: interaction.user.id },
    'Fehler bei der Ausfuehrung eines Befehls',
  );

  const message = isKnownError
    ? error.message
    : 'Bei der Ausfuehrung des Befehls ist ein unerwarteter Fehler aufgetreten.';

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    logger.error({ err: replyError }, 'Konnte Fehlermeldung nicht an Nutzer senden');
  }
}

export default event;

import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { updateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { ValidationError } from '../../../utils/errors.js';
import { buildVerificationPrompt } from '../../ui/verificationMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-verifizierung')
    .setDescription('Konfiguriert die Verifizierung neuer Mitglieder (nur Admins).')
    .addRoleOption((option) =>
      option
        .setName('rolle')
        .setDescription('Rolle, die verifizierte Mitglieder erhalten')
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Textkanal, in dem die Verifizierungsnachricht gepostet wird')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const role = interaction.options.getRole('rolle', true);
    const channel = interaction.options.getChannel('kanal', false, [ChannelType.GuildText]);

    await updateGuildConfig(interaction.guild.id, {
      verifiedRoleId: role.id,
      ...(channel ? { welcomeChannelId: channel.id } : {}),
    });

    if (channel) {
      try {
        await channel.send(buildVerificationPrompt());
      } catch {
        throw new ValidationError(
          `Die Konfiguration wurde gespeichert, aber ich konnte keine Nachricht in ${channel} senden. ` +
            'Bitte pruefe meine Kanal-Berechtigungen (Nachrichten senden, Embeds einbetten).',
        );
      }
    }

    const channelInfo = channel
      ? `, Verifizierungs-Kanal: ${channel}`
      : ' (kein Kanal gesetzt, Verifizierung nur per DM oder /verifizieren moeglich).';

    await interaction.reply({
      content: `Verifizierung konfiguriert. Rolle: ${role}${channelInfo}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

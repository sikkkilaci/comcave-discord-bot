import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { importLocationsAsAdmin } from '../../../services/locationImportService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-standorte-importieren')
    .setDescription(
      '📍 Importiert/aktualisiert den COMCAVE-Standort-Katalog aus der Quelldatei (nur Admins).',
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const summary = await importLocationsAsAdmin(guildConfig, member, interaction.user.id);

    await interaction.reply({
      content:
        `Standort-Import abgeschlossen: ${summary.created} neu, ${summary.updated} aktualisiert, ` +
        `${summary.deactivated} deaktiviert.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

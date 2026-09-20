import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('konfiguration')
    .setDescription('Zeigt die aktuelle Bot-Konfiguration dieses Servers an (nur Admins).'),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guildId) return;

    const config = await getOrCreateGuildConfig(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('Bot-Konfiguration')
      .setColor(0x2b2d31)
      .addFields(
        {
          name: 'Admin-Rolle',
          value: config.adminRoleId ? `<@&${config.adminRoleId}>` : 'nicht gesetzt',
          inline: true,
        },
        {
          name: 'Moderator-Rolle',
          value: config.moderatorRoleId ? `<@&${config.moderatorRoleId}>` : 'nicht gesetzt',
          inline: true,
        },
        {
          name: 'Verifiziert-Rolle',
          value: config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'nicht gesetzt',
          inline: true,
        },
        {
          name: 'Log-Kanal',
          value: config.logChannelId ? `<#${config.logChannelId}>` : 'nicht gesetzt',
          inline: true,
        },
        {
          name: 'Willkommens-Kanal',
          value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'nicht gesetzt',
          inline: true,
        },
        {
          name: '#wo-bin-ich',
          value: config.whereAmIChannelId ? `<#${config.whereAmIChannelId}>` : 'nicht gesetzt',
          inline: true,
        },
      )
      .setFooter({ text: 'Konfiguration ueber zukuenftige /setup-Befehle anpassbar.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;

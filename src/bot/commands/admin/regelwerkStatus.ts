import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getRuleAcceptanceStatus } from '../../../services/ruleService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('regelwerk-status')
    .setDescription('📜 Zeigt die Zustimmungsquote zur aktuellen Regelversion (nur Admins).'),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const status = await getRuleAcceptanceStatus(guildConfig, member);

    const embed = new EmbedBuilder()
      .setTitle(`📜 Regelwerk-Status - Version ${status.ruleSet.version}`)
      .setColor(0x2b2d31)
      .addFields(
        { name: 'Zugestimmt', value: `${status.acceptedCount}`, inline: true },
        {
          name: 'Verifizierte Mitglieder gesamt',
          value: `${status.totalVerifiedMembers}`,
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;

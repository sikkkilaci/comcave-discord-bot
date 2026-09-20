import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { listDailyReportsForClass } from '../../../services/dailyReportService.js';
import { buildDailyReportListEmbed } from '../../ui/reportMessage.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tagesberichte-anzeigen')
    .setDescription('📋 Zeigt die Tagesberichte einer Klasse an (Standard: die eigene Klasse).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse (Standard: deine eigene Klasse)')
        .setRequired(false)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const requested = interaction.options.getString('klasse');
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const { className, reports } = await listDailyReportsForClass(
      guildConfig,
      member,
      requested ? classNameSchema.parse(requested) : null,
    );

    await interaction.reply({
      embeds: [buildDailyReportListEmbed(className, reports)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

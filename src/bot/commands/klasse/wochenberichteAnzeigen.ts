import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { listWeeklyReportsForClass } from '../../../services/weeklyReportService.js';
import { buildWeeklyReportListEmbed } from '../../ui/reportMessage.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wochenberichte-anzeigen')
    .setDescription('📅 Zeigt die Wochenberichte einer Klasse an (Standard: die eigene Klasse).')
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

    const { className, reports } = await listWeeklyReportsForClass(
      guildConfig,
      member,
      requested ? classNameSchema.parse(requested) : null,
    );

    await interaction.reply({
      embeds: [buildWeeklyReportListEmbed(className, reports)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { deleteWeeklyReportForClass } from '../../../services/weeklyReportService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wochenbericht-loeschen')
    .setDescription('📅 Loescht einen Wochenbericht (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('bericht-id')
        .setDescription('ID des Wochenberichts (siehe /wochenberichte-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const reportId = interaction.options.getString('bericht-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const report = await deleteWeeklyReportForClass(
      guildConfig,
      member,
      reportId,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📅 Wochenbericht KW ${report.calendarWeek}/${report.year} wurde geloescht.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

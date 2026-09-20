import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { deleteDailyReportForClass } from '../../../services/dailyReportService.js';
import { formatGermanDate } from '../../../utils/dateTime.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tagesbericht-loeschen')
    .setDescription('📋 Loescht einen Tagesbericht (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('bericht-id')
        .setDescription('ID des Tagesberichts (siehe /tagesberichte-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const reportId = interaction.options.getString('bericht-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const report = await deleteDailyReportForClass(
      guildConfig,
      member,
      reportId,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📋 Tagesbericht vom ${formatGermanDate(report.date)} wurde geloescht.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

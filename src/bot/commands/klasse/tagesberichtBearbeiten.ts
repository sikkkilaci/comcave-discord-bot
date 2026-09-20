import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import {
  updateDailyReportForClass,
  type DailyReportEditInput,
} from '../../../services/dailyReportService.js';
import { formatGermanDate } from '../../../utils/dateTime.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tagesbericht-bearbeiten')
    .setDescription('📋 Bearbeitet einen Tagesbericht (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('bericht-id')
        .setDescription('ID des Tagesberichts (siehe /tagesberichte-anzeigen)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Neues Datum im Format TT.MM.JJJJ')
        .setRequired(false)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option.setName('themen').setDescription('Neue Themen').setRequired(false).setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lerninhalte')
        .setDescription('Neue Lerninhalte')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('hinweise')
        .setDescription('Neue Hinweise')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lernmaterialien')
        .setDescription('Neue Lernmaterialien')
        .setRequired(false)
        .setMaxLength(500),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const reportId = interaction.options.getString('bericht-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const input: DailyReportEditInput = {};
    const datum = interaction.options.getString('datum');
    const themen = interaction.options.getString('themen');
    const lerninhalte = interaction.options.getString('lerninhalte');
    const hinweise = interaction.options.getString('hinweise');
    const lernmaterialien = interaction.options.getString('lernmaterialien');
    if (datum !== null) input.datum = datum;
    if (themen !== null) input.themen = themen;
    if (lerninhalte !== null) input.lerninhalte = lerninhalte;
    if (hinweise !== null) input.hinweise = hinweise;
    if (lernmaterialien !== null) input.lernmaterialien = lernmaterialien;

    const report = await updateDailyReportForClass(
      guildConfig,
      member,
      reportId,
      input,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📋 Tagesbericht vom ${formatGermanDate(report.date)} wurde aktualisiert.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

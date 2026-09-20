import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import {
  updateWeeklyReportForClass,
  type WeeklyReportEditInput,
} from '../../../services/weeklyReportService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wochenbericht-bearbeiten')
    .setDescription('📅 Bearbeitet einen Wochenbericht (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('bericht-id')
        .setDescription('ID des Wochenberichts (siehe /wochenberichte-anzeigen)')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('kalenderwoche')
        .setDescription('Neue Kalenderwoche (1-53)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(53),
    )
    .addStringOption((option) =>
      option
        .setName('zeitraum-start')
        .setDescription(
          'Neuer Zeitraum-Beginn im Format TT.MM.JJJJ (nur zusammen mit zeitraum-ende)',
        )
        .setRequired(false)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option
        .setName('zeitraum-ende')
        .setDescription(
          'Neues Zeitraum-Ende im Format TT.MM.JJJJ (nur zusammen mit zeitraum-start)',
        )
        .setRequired(false)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option.setName('themen').setDescription('Neue Themen').setRequired(false).setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lernfortschritt')
        .setDescription('Neuer Lernfortschritt')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('hinweise')
        .setDescription('Neue Hinweise')
        .setRequired(false)
        .setMaxLength(1000),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const reportId = interaction.options.getString('bericht-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const input: WeeklyReportEditInput = {};
    const kalenderwoche = interaction.options.getInteger('kalenderwoche');
    const zeitraumStart = interaction.options.getString('zeitraum-start');
    const zeitraumEnde = interaction.options.getString('zeitraum-ende');
    const themen = interaction.options.getString('themen');
    const lernfortschritt = interaction.options.getString('lernfortschritt');
    const hinweise = interaction.options.getString('hinweise');
    if (kalenderwoche !== null) input.kalenderwoche = kalenderwoche;
    if (zeitraumStart !== null) input.zeitraumStart = zeitraumStart;
    if (zeitraumEnde !== null) input.zeitraumEnde = zeitraumEnde;
    if (themen !== null) input.themen = themen;
    if (lernfortschritt !== null) input.lernfortschritt = lernfortschritt;
    if (hinweise !== null) input.hinweise = hinweise;

    const report = await updateWeeklyReportForClass(
      guildConfig,
      member,
      reportId,
      input,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📅 Wochenbericht KW ${report.calendarWeek}/${report.year} wurde aktualisiert.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

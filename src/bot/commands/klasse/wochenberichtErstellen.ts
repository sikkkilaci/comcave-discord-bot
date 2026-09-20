import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { createWeeklyReportForClass } from '../../../services/weeklyReportService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wochenbericht-erstellen')
    .setDescription('📅 Legt einen Wochenbericht fuer eine Klasse an (Admin/Klassenleitung).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die der Wochenbericht gilt')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    )
    .addIntegerOption((option) =>
      option
        .setName('kalenderwoche')
        .setDescription('Kalenderwoche (1-53)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(53),
    )
    .addStringOption((option) =>
      option
        .setName('zeitraum-start')
        .setDescription('Beginn des Zeitraums im Format TT.MM.JJJJ')
        .setRequired(true)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option
        .setName('zeitraum-ende')
        .setDescription('Ende des Zeitraums im Format TT.MM.JJJJ')
        .setRequired(true)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option
        .setName('themen')
        .setDescription('Behandelte Themen')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lernfortschritt')
        .setDescription('Lernfortschritt/Inhalte')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('hinweise')
        .setDescription('Besondere Hinweise')
        .setRequired(true)
        .setMaxLength(1000),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const report = await createWeeklyReportForClass(
      guildConfig,
      member,
      className,
      {
        kalenderwoche: interaction.options.getInteger('kalenderwoche', true),
        zeitraumStart: interaction.options.getString('zeitraum-start', true),
        zeitraumEnde: interaction.options.getString('zeitraum-ende', true),
        themen: interaction.options.getString('themen', true),
        lernfortschritt: interaction.options.getString('lernfortschritt', true),
        hinweise: interaction.options.getString('hinweise', true),
      },
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `📅 Wochenbericht KW ${report.calendarWeek}/${report.year} fuer ` +
        `${CLASS_NAME_LABELS[className]} angelegt. ID: \`${report.id}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

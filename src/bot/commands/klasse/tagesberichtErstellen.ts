import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { createDailyReportForClass } from '../../../services/dailyReportService.js';
import { formatGermanDate } from '../../../utils/dateTime.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tagesbericht-erstellen')
    .setDescription('📋 Legt einen Tagesbericht fuer eine Klasse an (Admin/Klassenleitung).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die der Tagesbericht gilt')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    )
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Datum im Format TT.MM.JJJJ')
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
        .setName('lerninhalte')
        .setDescription('Lerninhalte')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('hinweise')
        .setDescription('Besondere Hinweise')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lernmaterialien')
        .setDescription('Optional verknuepfte Lernmaterialien')
        .setRequired(false)
        .setMaxLength(500),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const report = await createDailyReportForClass(
      guildConfig,
      member,
      className,
      {
        datum: interaction.options.getString('datum', true),
        themen: interaction.options.getString('themen', true),
        lerninhalte: interaction.options.getString('lerninhalte', true),
        hinweise: interaction.options.getString('hinweise', true),
        lernmaterialien: interaction.options.getString('lernmaterialien'),
      },
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `📋 Tagesbericht fuer ${CLASS_NAME_LABELS[className]} am ${formatGermanDate(report.date)} ` +
        `angelegt. ID: \`${report.id}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

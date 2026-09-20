import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { updateExamForClass, type ExamEditInput } from '../../../services/examService.js';
import { formatGermanDateTime } from '../../../utils/dateTime.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pruefung-bearbeiten')
    .setDescription(
      '🎓 Bearbeitet eine bestehende Pruefung (Admin/Klassenleitung der eigenen Klasse).',
    )
    .addStringOption((option) =>
      option
        .setName('pruefung-id')
        .setDescription('ID der Pruefung (siehe /pruefungen-anzeigen)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('fach')
        .setDescription('Neues Fach/Thema')
        .setRequired(false)
        .setMaxLength(150),
    )
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Neues Datum im Format TT.MM.JJJJ (nur zusammen mit uhrzeit)')
        .setRequired(false)
        .setMaxLength(10),
    )
    .addStringOption((option) =>
      option
        .setName('uhrzeit')
        .setDescription('Neue Uhrzeit im Format HH:MM (nur zusammen mit datum)')
        .setRequired(false)
        .setMaxLength(5),
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Neue Beschreibung')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('lernhinweise')
        .setDescription('Neue Lernhinweise')
        .setRequired(false)
        .setMaxLength(500),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const examId = interaction.options.getString('pruefung-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const input: ExamEditInput = {};
    const fach = interaction.options.getString('fach');
    const beschreibung = interaction.options.getString('beschreibung');
    const lernhinweise = interaction.options.getString('lernhinweise');
    const datum = interaction.options.getString('datum');
    const uhrzeit = interaction.options.getString('uhrzeit');
    if (fach !== null) input.fach = fach;
    if (beschreibung !== null) input.beschreibung = beschreibung;
    if (lernhinweise !== null) input.lernhinweise = lernhinweise;
    if (datum !== null) input.datum = datum;
    if (uhrzeit !== null) input.uhrzeit = uhrzeit;

    const exam = await updateExamForClass(guildConfig, member, examId, input, interaction.user.id);

    await interaction.reply({
      content:
        `🎓 Pruefung **${exam.subject}** aktualisiert ` +
        `(${formatGermanDateTime(exam.scheduledAt)}).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

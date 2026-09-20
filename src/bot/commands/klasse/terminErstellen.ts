import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { createAppointmentForClass } from '../../../services/appointmentService.js';
import { formatGermanDateTime } from '../../../utils/dateTime.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('termin-erstellen')
    .setDescription('📅 Legt einen Termin fuer eine Klasse an (Admin/Klassenleitung).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die der Termin gilt')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    )
    .addStringOption((option) =>
      option
        .setName('titel')
        .setDescription('Titel des Termins')
        .setRequired(true)
        .setMaxLength(150),
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
        .setName('uhrzeit')
        .setDescription('Uhrzeit im Format HH:MM')
        .setRequired(true)
        .setMaxLength(5),
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Beschreibung des Termins')
        .setRequired(true)
        .setMaxLength(1000),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const appointment = await createAppointmentForClass(
      guildConfig,
      member,
      className,
      {
        titel: interaction.options.getString('titel', true),
        beschreibung: interaction.options.getString('beschreibung', true),
        datum: interaction.options.getString('datum', true),
        uhrzeit: interaction.options.getString('uhrzeit', true),
      },
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `📅 Termin **${appointment.title}** fuer ${CLASS_NAME_LABELS[className]} angelegt ` +
        `(${formatGermanDateTime(appointment.scheduledAt)}). ID: \`${appointment.id}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

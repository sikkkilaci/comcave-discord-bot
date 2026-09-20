import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import {
  updateAppointmentForClass,
  type AppointmentEditInput,
} from '../../../services/appointmentService.js';
import { formatGermanDateTime } from '../../../utils/dateTime.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('termin-bearbeiten')
    .setDescription(
      '📅 Bearbeitet einen bestehenden Termin (Admin/Klassenleitung der eigenen Klasse).',
    )
    .addStringOption((option) =>
      option
        .setName('termin-id')
        .setDescription('ID des Termins (siehe /termine-anzeigen)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('titel').setDescription('Neuer Titel').setRequired(false).setMaxLength(150),
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
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const appointmentId = interaction.options.getString('termin-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const input: AppointmentEditInput = {};
    const titel = interaction.options.getString('titel');
    const beschreibung = interaction.options.getString('beschreibung');
    const datum = interaction.options.getString('datum');
    const uhrzeit = interaction.options.getString('uhrzeit');
    if (titel !== null) input.titel = titel;
    if (beschreibung !== null) input.beschreibung = beschreibung;
    if (datum !== null) input.datum = datum;
    if (uhrzeit !== null) input.uhrzeit = uhrzeit;

    const appointment = await updateAppointmentForClass(
      guildConfig,
      member,
      appointmentId,
      input,
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `📅 Termin **${appointment.title}** aktualisiert ` +
        `(${formatGermanDateTime(appointment.scheduledAt)}).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

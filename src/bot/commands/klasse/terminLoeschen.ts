import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { deleteAppointmentForClass } from '../../../services/appointmentService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('termin-loeschen')
    .setDescription('📅 Loescht einen Termin (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('termin-id')
        .setDescription('ID des Termins (siehe /termine-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const appointmentId = interaction.options.getString('termin-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const appointment = await deleteAppointmentForClass(
      guildConfig,
      member,
      appointmentId,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📅 Termin **${appointment.title}** wurde geloescht.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

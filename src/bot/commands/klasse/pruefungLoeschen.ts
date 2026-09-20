import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { deleteExamForClass } from '../../../services/examService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pruefung-loeschen')
    .setDescription('🎓 Loescht eine Pruefung (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('pruefung-id')
        .setDescription('ID der Pruefung (siehe /pruefungen-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const examId = interaction.options.getString('pruefung-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const exam = await deleteExamForClass(guildConfig, member, examId, interaction.user.id);

    await interaction.reply({
      content: `🎓 Pruefung **${exam.subject}** wurde geloescht.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

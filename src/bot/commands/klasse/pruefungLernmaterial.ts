import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { listLearningMaterialsLinkedToExam } from '../../../services/learningMaterialService.js';
import { buildLearningMaterialListEmbed } from '../../ui/learningMaterialMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pruefung-lernmaterial')
    .setDescription('📚 Zeigt das mit einer Pruefung verknuepfte Lernmaterial an.')
    .addStringOption((option) =>
      option
        .setName('pruefung-id')
        .setDescription('ID der Pruefung (siehe /pruefungen-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const examId = interaction.options.getString('pruefung-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const { exam, className, materials } = await listLearningMaterialsLinkedToExam(
      guildConfig,
      member,
      examId,
    );

    const embed = buildLearningMaterialListEmbed(className, materials).setTitle(
      `📚 Lernmaterial zu Pruefung "${exam.subject}"`,
    );
    if (materials.length === 0) {
      embed.setDescription('Mit dieser Pruefung ist aktuell kein Lernmaterial verknuepft.');
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;

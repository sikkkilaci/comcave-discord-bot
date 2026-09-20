import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { deleteLearningMaterialForClass } from '../../../services/learningMaterialService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lernmaterial-loeschen')
    .setDescription('📚 Loescht Lernmaterial (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('material-id')
        .setDescription('ID des Materials (siehe /lernmaterial-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const materialId = interaction.options.getString('material-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const material = await deleteLearningMaterialForClass(
      guildConfig,
      member,
      materialId,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📚 Lernmaterial **${material.title}** wurde geloescht.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

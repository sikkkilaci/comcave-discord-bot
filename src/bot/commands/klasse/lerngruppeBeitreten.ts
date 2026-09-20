import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { joinStudyGroup } from '../../../services/studyGroupService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-beitreten')
    .setDescription('Trittst einer Lerngruppe deiner Klasse bei.')
    .addStringOption((option) =>
      option
        .setName('gruppe-id')
        .setDescription('ID der Lerngruppe (siehe /lerngruppen-anzeigen)')
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const groupId = interaction.options.getString('gruppe-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const { changed, group } = await joinStudyGroup(
      guildConfig,
      member,
      groupId,
      interaction.user.id,
    );

    const content = changed
      ? `Du bist der Lerngruppe **${group.name}** beigetreten.`
      : `Du bist bereits Mitglied der Lerngruppe **${group.name}**.`;

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};

export default command;

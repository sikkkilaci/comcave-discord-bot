import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { leaveStudyGroup } from '../../../services/studyGroupService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-verlassen')
    .setDescription('Verlaesst eine Lerngruppe, der du beigetreten bist.')
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

    const group = await leaveStudyGroup(guildConfig, member, groupId, interaction.user.id);

    await interaction.reply({
      content: `Du hast die Lerngruppe **${group.name}** verlassen.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

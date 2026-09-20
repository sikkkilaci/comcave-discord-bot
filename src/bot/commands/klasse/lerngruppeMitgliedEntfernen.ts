import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { removeStudyGroupMemberByModerator } from '../../../services/studyGroupService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-mitglied-entfernen')
    .setDescription('Entfernt ein Mitglied aus einer Lerngruppe (Klassenleitung/Admin).')
    .addStringOption((option) =>
      option
        .setName('gruppe-id')
        .setDescription('ID der Lerngruppe (siehe /lerngruppe-status)')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option.setName('mitglied').setDescription('Zu entfernendes Mitglied').setRequired(true),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const groupId = interaction.options.getString('gruppe-id', true);
    const target = interaction.options.getUser('mitglied', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const group = await removeStudyGroupMemberByModerator(
      guildConfig,
      member,
      groupId,
      target.id,
      interaction.user.id,
    );

    await interaction.reply({
      content: `${target} wurde aus der Lerngruppe **${group.name}** entfernt.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

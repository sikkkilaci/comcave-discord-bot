import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { closeStudyGroup } from '../../../services/studyGroupService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-schliessen')
    .setDescription('Schliesst eine Lerngruppe (Ersteller:in, Klassenleitung oder Admin).')
    .addStringOption((option) =>
      option
        .setName('gruppe-id')
        .setDescription('ID der Lerngruppe (siehe /lerngruppen-anzeigen)')
        .setRequired(true),
    ),
  // VERIFIED, da auch die Ersteller:in (ein normales Mitglied) die eigene
  // Gruppe schliessen darf - die eigentliche Einschraenkung erfolgt in
  // closeStudyGroup() (Admin/Klassenleitung ODER Ersteller:in der Gruppe).
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const groupId = interaction.options.getString('gruppe-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const group = await closeStudyGroup(guildConfig, member, groupId, interaction.user.id);

    await interaction.reply({
      content: `Lerngruppe **${group.name}** wurde geschlossen.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

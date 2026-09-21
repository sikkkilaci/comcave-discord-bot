import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getConfirmedClassOverview, getCurrentClassName } from '../../../services/classService.js';
import { buildClassSelectionMessage } from '../../ui/classMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wo-bin-ich')
    .setDescription('🏫 Zeigt die Klassenauswahl an (nach erfolgreicher Verifizierung).'),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    // getCurrentClassName wirft PermissionError, wenn das Mitglied noch nicht
    // verifiziert ist - wird zentral von interactionCreate abgefangen.
    const currentClassName = await getCurrentClassName(interaction.guild.id, member.id);
    const overview = await getConfirmedClassOverview(interaction.guild.id);
    const { embeds, components } = buildClassSelectionMessage(overview, currentClassName);

    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  },
};

export default command;

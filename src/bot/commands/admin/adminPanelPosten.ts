import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { postAdminPanel } from '../../../services/adminPanelService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-panel-posten')
    .setDescription(
      '⚙️ Postet das Admin-Panel (Kursplan/Kursinhalte per Klick) im Verwaltungskanal (nur Admins).',
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const result = await postAdminPanel(interaction.guild);

    await interaction.reply({
      content: result.posted
        ? `Admin-Panel in <#${result.channelId}> gepostet.`
        : `Admin-Panel existiert in <#${result.channelId}> bereits - nicht erneut gepostet.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

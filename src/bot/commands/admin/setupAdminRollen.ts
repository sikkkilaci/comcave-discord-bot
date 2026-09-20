import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { configureAdminRoles, type AdminRolesInput } from '../../../services/guildConfigService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-admin-rollen')
    .setDescription('🛡️ Konfiguriert die Admin-/Moderator-Rolle des Bots (nur Admins).')
    .addRoleOption((option) =>
      option
        .setName('admin-rolle')
        .setDescription('Rolle, die Mitglieder zu globalen Bot-Admins macht')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('moderator-rolle')
        .setDescription(
          'Optionale Moderator-Rolle (aktuell nur gespeichert, noch ohne eigene Berechtigungen)',
        )
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const adminRole = interaction.options.getRole('admin-rolle', true);
    const moderatorRole = interaction.options.getRole('moderator-rolle');

    const input: AdminRolesInput = {
      adminRole,
      ...(moderatorRole ? { moderatorRole } : {}),
    };
    const updated = await configureAdminRoles(interaction.guild.id, input, interaction.user.id);

    const moderatorInfo = updated.moderatorRoleId
      ? `, Moderator-Rolle: <@&${updated.moderatorRoleId}> (aktuell ohne eigene Berechtigungen)`
      : '';

    await interaction.reply({
      content: `Admin-Rolle konfiguriert: <@&${updated.adminRoleId}>${moderatorInfo}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

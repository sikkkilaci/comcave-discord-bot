import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { updateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { updateClassRole } from '../../../repositories/classRepository.js';
import { logAuditEvent } from '../../../repositories/auditLogRepository.js';
import { ValidationError } from '../../../utils/errors.js';
import { CLASS_NAME_LABELS } from '../../../types/domain.js';
import { buildClassSelectionMessage } from '../../ui/classMessage.js';
import { roleHasAdministrator } from '../../discordHelpers.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-klassen')
    .setDescription(
      '🏫 Konfiguriert die Klassenrollen A/B/C und den #wo-bin-ich-Kanal (nur Admins).',
    )
    .addRoleOption((option) =>
      option.setName('klasse-a').setDescription('Rolle fuer Klasse A').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('klasse-b').setDescription('Rolle fuer Klasse B').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('klasse-c').setDescription('Rolle fuer Klasse C').setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('#wo-bin-ich-Kanal, in dem die Klassenauswahl gepostet wird')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const roleA = interaction.options.getRole('klasse-a', true);
    const roleB = interaction.options.getRole('klasse-b', true);
    const roleC = interaction.options.getRole('klasse-c', true);
    const channel = interaction.options.getChannel('kanal', true, [ChannelType.GuildText]);

    const roles = [
      { name: 'A', role: roleA },
      { name: 'B', role: roleB },
      { name: 'C', role: roleC },
    ] as const;

    const roleIds = roles.map(({ role }) => role.id);
    if (new Set(roleIds).size !== roleIds.length) {
      throw new ValidationError(
        'Die drei Klassenrollen muessen unterschiedlich sein - jede Klasse braucht eine eigene Rolle.',
      );
    }

    for (const { name, role } of roles) {
      if (roleHasAdministrator(role)) {
        throw new ValidationError(
          `Die Rolle fuer Klasse ${name} (${role.name}) hat Administrator-Rechte. ` +
            'Klassenrollen duerfen keine globalen Administratorrechte haben - bitte eine andere Rolle waehlen.',
        );
      }
    }

    for (const { name, role } of roles) {
      await updateClassRole(interaction.guild.id, name, role.id);
    }

    await updateGuildConfig(interaction.guild.id, { whereAmIChannelId: channel.id });

    await logAuditEvent({
      guildId: interaction.guild.id,
      actorDiscordId: interaction.user.id,
      action: 'class.setup',
      metadata: {
        roles: { A: roleA.id, B: roleB.id, C: roleC.id },
        whereAmIChannelId: channel.id,
      },
    });

    try {
      await channel.send(buildClassSelectionMessage(null));
    } catch {
      throw new ValidationError(
        `Die Konfiguration wurde gespeichert, aber ich konnte keine Nachricht in ${channel} senden. ` +
          'Bitte pruefe meine Kanal-Berechtigungen (Nachrichten senden, Embeds einbetten).',
      );
    }

    await interaction.reply({
      content:
        `Klassen konfiguriert: ${CLASS_NAME_LABELS.A} -> ${roleA}, ${CLASS_NAME_LABELS.B} -> ${roleB}, ` +
        `${CLASS_NAME_LABELS.C} -> ${roleC}. #wo-bin-ich-Kanal: ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

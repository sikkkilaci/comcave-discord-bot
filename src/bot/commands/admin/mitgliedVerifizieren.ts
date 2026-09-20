import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { setMemberVerification } from '../../../services/verificationService.js';
import {
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  type VerificationStatus,
} from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mitglied-verifizieren')
    .setDescription('Setzt den Verifizierungsstatus eines Mitglieds (nur Admins).')
    .addUserOption((option) =>
      option.setName('nutzer').setDescription('Das zu bearbeitende Mitglied').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Neuer Verifizierungsstatus (Standard: Verifiziert)')
        .setRequired(false)
        .addChoices(
          ...VERIFICATION_STATUSES.map((status) => ({
            name: VERIFICATION_STATUS_LABELS[status],
            value: status,
          })),
        ),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetMember = interaction.options.getMember('nutzer') as GuildMember | null;
    if (!targetMember) {
      await interaction.reply({
        content: 'Dieses Mitglied konnte nicht gefunden werden (evtl. nicht mehr auf dem Server).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const status = (interaction.options.getString('status') ?? 'VERIFIED') as VerificationStatus;

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const result = await setMemberVerification(
      targetMember,
      guildConfig,
      status,
      interaction.user.id,
    );

    const content = result.changed
      ? `Status von ${targetMember} wurde auf **${VERIFICATION_STATUS_LABELS[status]}** gesetzt.`
      : `${targetMember} hatte bereits den Status **${VERIFICATION_STATUS_LABELS[status]}**.`;

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};

export default command;

import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getMember } from '../../../repositories/memberRepository.js';
import { isServerAdmin } from '../../../permissions/checkPermission.js';
import { PermissionError } from '../../../utils/errors.js';
import { VERIFICATION_STATUS_LABELS, type VerificationStatus } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('verifizierung-status')
    .setDescription('🔐 Zeigt deinen Verifizierungsstatus an.')
    .addUserOption((option) =>
      option
        .setName('nutzer')
        .setDescription('Status eines anderen Mitglieds anzeigen (nur Admins)')
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('nutzer');
    const isOwnStatus = !targetUser || targetUser.id === interaction.user.id;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    if (!isOwnStatus) {
      const requestingMember = interaction.member as GuildMember;
      if (!isServerAdmin(requestingMember, guildConfig)) {
        throw new PermissionError(
          'Nur Admins duerfen den Verifizierungsstatus anderer Mitglieder einsehen.',
        );
      }
    }

    const lookupId = targetUser?.id ?? interaction.user.id;
    const member = await getMember(interaction.guild.id, lookupId);
    const status: VerificationStatus =
      (member?.verificationStatus as VerificationStatus) ?? 'PENDING';

    const subject = isOwnStatus ? 'Du bist' : `<@${lookupId}> ist`;

    await interaction.reply({
      content: `${subject} aktuell: **${VERIFICATION_STATUS_LABELS[status]}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

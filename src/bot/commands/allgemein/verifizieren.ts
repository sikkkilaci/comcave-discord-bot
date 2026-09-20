import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { setMemberVerification } from '../../../services/verificationService.js';
import { buildSafeOnboardingReplyPart } from '../../ui/onboardingMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('verifizieren')
    .setDescription('Verifiziert dich selbst, um vollen Zugriff auf den Server zu erhalten.'),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const member = interaction.member as GuildMember;
    const result = await setMemberVerification(member, guildConfig, 'VERIFIED', member.id);

    const content = result.changed
      ? 'Du wurdest erfolgreich verifiziert! Willkommen in der Lerngruppe. 🎉'
      : 'Du bist bereits verifiziert.';

    const onboardingPart = await buildSafeOnboardingReplyPart(interaction.guild.id, member.id);

    await interaction.reply({ content, ...onboardingPart, flags: MessageFlags.Ephemeral });
  },
};

export default command;

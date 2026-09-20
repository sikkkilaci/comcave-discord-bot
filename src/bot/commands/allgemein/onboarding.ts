import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOnboardingState } from '../../../services/onboardingService.js';
import { buildOnboardingMessageForState } from '../../ui/onboardingMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('onboarding')
    .setDescription(
      '🧑‍💻 Startet oder setzt den Onboarding-Fragebogen fort (nach erfolgreicher Verifizierung).',
    ),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    // getOnboardingState wirft PermissionError, wenn das Mitglied noch nicht
    // verifiziert ist - wird zentral von interactionCreate abgefangen und als
    // verstaendliche Fehlermeldung angezeigt.
    const state = await getOnboardingState(interaction.guild.id, member.id);
    const { embeds, components } = buildOnboardingMessageForState(state);

    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  },
};

export default command;

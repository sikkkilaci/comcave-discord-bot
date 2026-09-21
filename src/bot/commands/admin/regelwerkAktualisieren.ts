import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { RULE_CONTENT_MAX_LENGTH, updateRules } from '../../../services/ruleService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('regelwerk-aktualisieren')
    .setDescription('📜 Legt eine neue, aktive Version der Serverregeln an (nur Admins).')
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('Vollstaendiger neuer Regeltext')
        .setRequired(true)
        .setMaxLength(RULE_CONTENT_MAX_LENGTH),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const content = interaction.options.getString('text', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const ruleSet = await updateRules(guildConfig, member, content, interaction.user.id);

    await interaction.reply({
      content:
        `Regelwerk aktualisiert: Version ${ruleSet.version} ist jetzt aktiv. Alle Mitglieder ` +
        'muessen dieser Version erneut zustimmen, bevor sie mit Onboarding/Klassenwahl fortfahren koennen.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

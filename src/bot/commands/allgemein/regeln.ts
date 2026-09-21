import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getCurrentRuleSet, hasAcceptedCurrentRules } from '../../../services/ruleService.js';
import { buildRulesMessage } from '../../ui/rulesMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('regeln')
    .setDescription('📜 Zeigt die aktuellen Serverregeln an (jederzeit nachlesbar).'),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const ruleSet = await getCurrentRuleSet(interaction.guild.id);
    if (!ruleSet) {
      await interaction.reply({
        content:
          'Es ist noch kein Regelwerk konfiguriert. Ein Admin muss zuerst /regelwerk-aktualisieren ausfuehren.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const alreadyAccepted = await hasAcceptedCurrentRules(interaction.guild.id, member.id);
    const { embeds, components } = buildRulesMessage(ruleSet, alreadyAccepted);

    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  },
};

export default command;

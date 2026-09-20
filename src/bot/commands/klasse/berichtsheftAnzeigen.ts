import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getBerichtsheftForClass } from '../../../services/berichtsheftService.js';
import { buildBerichtsheftEmbed } from '../../ui/reportMessage.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('berichtsheft-anzeigen')
    .setDescription(
      '📝 Zeigt das Berichtsheft (Tages- + Wochenberichte) einer Klasse an (Standard: eigene Klasse).',
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse (Standard: deine eigene Klasse)')
        .setRequired(false)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const requested = interaction.options.getString('klasse');
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const { className, entries } = await getBerichtsheftForClass(
      guildConfig,
      member,
      requested ? classNameSchema.parse(requested) : null,
    );

    await interaction.reply({
      embeds: [buildBerichtsheftEmbed(className, entries)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

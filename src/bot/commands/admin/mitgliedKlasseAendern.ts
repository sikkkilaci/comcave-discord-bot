import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { assignClass } from '../../../services/classService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, type ClassName } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mitglied-klasse-aendern')
    .setDescription(
      '🏫 Aendert die Klasse eines Mitglieds (nur Admins - Selbstbedienung ist einmalig gesperrt).',
    )
    .addUserOption((option) =>
      option.setName('nutzer').setDescription('Das zu bearbeitende Mitglied').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Neue Klasse')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
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

    const className = interaction.options.getString('klasse', true) as ClassName;

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const result = await assignClass(targetMember, guildConfig, className, interaction.user.id, {
      allowChange: true,
    });

    const content = result.changed
      ? result.previousClassName
        ? `${targetMember} wurde von ${CLASS_NAME_LABELS[result.previousClassName]} zu ` +
          `${CLASS_NAME_LABELS[result.newClassName]} verschoben.`
        : `${targetMember} ist jetzt in ${CLASS_NAME_LABELS[result.newClassName]}.`
      : `${targetMember} ist bereits in ${CLASS_NAME_LABELS[result.newClassName]}.`;

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};

export default command;

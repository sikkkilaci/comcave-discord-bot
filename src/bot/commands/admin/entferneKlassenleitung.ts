import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { removeClassLead } from '../../../services/classLeadService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('entferne-klassenleitung')
    .setDescription('👑 Entfernt die aktuell zugewiesene Klassenleitung einer Klasse (nur Admins).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, deren Klassenleitung entfernt wird')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const result = await removeClassLead(
      interaction.guild,
      guildConfig,
      className,
      interaction.user.id,
    );

    const content = result.changed
      ? `Klassenleitung von ${CLASS_NAME_LABELS[className]} wurde entfernt (<@${result.removedDiscordId}>).`
      : `${CLASS_NAME_LABELS[className]} hatte aktuell keine zugewiesene Klassenleitung.`;

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};

export default command;

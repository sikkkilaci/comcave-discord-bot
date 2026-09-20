import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { createStudyGroupForClass } from '../../../services/studyGroupService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-erstellen')
    .setDescription('Gruendet eine Lerngruppe fuer die eigene Klasse.')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Name der Lerngruppe')
        .setRequired(true)
        .setMaxLength(100),
    )
    .addIntegerOption((option) =>
      option
        .setName('teilnehmerlimit')
        .setDescription('Optionale maximale Teilnehmerzahl')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100),
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

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const requested = interaction.options.getString('klasse');

    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      requested ? classNameSchema.parse(requested) : null,
      {
        name: interaction.options.getString('name', true),
        maxParticipants: interaction.options.getInteger('teilnehmerlimit'),
      },
      interaction.user.id,
    );

    await interaction.reply({
      content: `Lerngruppe **${group.name}** wurde gegruendet. ID: \`${group.id}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { createLearningMaterialForClass } from '../../../services/learningMaterialService.js';
import {
  CLASS_NAMES,
  CLASS_NAME_LABELS,
  classNameSchema,
  LEARNING_MATERIAL_CATEGORIES,
  LEARNING_MATERIAL_CATEGORY_LABELS,
  LEARNING_MATERIAL_LINK_TYPES,
  LEARNING_MATERIAL_LINK_TYPE_LABELS,
} from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lernmaterial-erstellen')
    .setDescription('📚 Legt Lernmaterial fuer eine Klasse an (Admin/Klassenleitung).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die das Material gilt')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    )
    .addStringOption((option) =>
      option
        .setName('titel')
        .setDescription('Titel des Materials')
        .setRequired(true)
        .setMaxLength(150),
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Beschreibung')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option.setName('fach').setDescription('Fach/Thema').setRequired(true).setMaxLength(150),
    )
    .addStringOption((option) =>
      option
        .setName('kategorie')
        .setDescription('Kategorie')
        .setRequired(true)
        .addChoices(
          ...LEARNING_MATERIAL_CATEGORIES.map((category) => ({
            name: LEARNING_MATERIAL_CATEGORY_LABELS[category],
            value: category,
          })),
        ),
    )
    .addStringOption((option) =>
      option.setName('url').setDescription('Optionaler Link').setRequired(false).setMaxLength(500),
    )
    .addAttachmentOption((option) =>
      option.setName('datei').setDescription('Optionale Datei').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('verknuepfung-typ')
        .setDescription('Optional: Verknuepfung mit Pruefung oder Bericht derselben Klasse')
        .setRequired(false)
        .addChoices(
          ...LEARNING_MATERIAL_LINK_TYPES.map((type) => ({
            name: LEARNING_MATERIAL_LINK_TYPE_LABELS[type],
            value: type,
          })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName('verknuepfung-id')
        .setDescription('ID der Pruefung/des Berichts (nur zusammen mit verknuepfung-typ)')
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const datei = interaction.options.getAttachment('datei');

    const material = await createLearningMaterialForClass(
      guildConfig,
      member,
      className,
      {
        titel: interaction.options.getString('titel', true),
        beschreibung: interaction.options.getString('beschreibung', true),
        fach: interaction.options.getString('fach', true),
        kategorie: interaction.options.getString('kategorie', true),
        url: interaction.options.getString('url'),
        anhang: datei ? { url: datei.url, name: datei.name, contentType: datei.contentType } : null,
        verknuepfungTyp: interaction.options.getString('verknuepfung-typ'),
        verknuepfungId: interaction.options.getString('verknuepfung-id'),
      },
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `📚 Lernmaterial **${material.title}** fuer ${CLASS_NAME_LABELS[className]} angelegt. ` +
        `ID: \`${material.id}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

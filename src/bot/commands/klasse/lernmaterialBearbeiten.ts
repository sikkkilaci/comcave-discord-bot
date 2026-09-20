import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import {
  updateLearningMaterialForClass,
  type LearningMaterialEditInput,
} from '../../../services/learningMaterialService.js';
import {
  LEARNING_MATERIAL_CATEGORIES,
  LEARNING_MATERIAL_CATEGORY_LABELS,
  LEARNING_MATERIAL_LINK_TYPES,
  LEARNING_MATERIAL_LINK_TYPE_LABELS,
} from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lernmaterial-bearbeiten')
    .setDescription('📚 Bearbeitet Lernmaterial (Admin/Klassenleitung der eigenen Klasse).')
    .addStringOption((option) =>
      option
        .setName('material-id')
        .setDescription('ID des Materials (siehe /lernmaterial-anzeigen)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('titel').setDescription('Neuer Titel').setRequired(false).setMaxLength(150),
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Neue Beschreibung')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('fach')
        .setDescription('Neues Fach/Thema')
        .setRequired(false)
        .setMaxLength(150),
    )
    .addStringOption((option) =>
      option
        .setName('kategorie')
        .setDescription('Neue Kategorie')
        .setRequired(false)
        .addChoices(
          ...LEARNING_MATERIAL_CATEGORIES.map((category) => ({
            name: LEARNING_MATERIAL_CATEGORY_LABELS[category],
            value: category,
          })),
        ),
    )
    .addStringOption((option) =>
      option.setName('url').setDescription('Neuer Link').setRequired(false).setMaxLength(500),
    )
    .addAttachmentOption((option) =>
      option.setName('datei').setDescription('Neue Datei').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('verknuepfung-typ')
        .setDescription('Neue Verknuepfung: Typ (nur zusammen mit verknuepfung-id)')
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
        .setDescription('Neue Verknuepfung: ID (nur zusammen mit verknuepfung-typ)')
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const materialId = interaction.options.getString('material-id', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const input: LearningMaterialEditInput = {};
    const titel = interaction.options.getString('titel');
    const beschreibung = interaction.options.getString('beschreibung');
    const fach = interaction.options.getString('fach');
    const kategorie = interaction.options.getString('kategorie');
    const url = interaction.options.getString('url');
    const datei = interaction.options.getAttachment('datei');
    const verknuepfungTyp = interaction.options.getString('verknuepfung-typ');
    const verknuepfungId = interaction.options.getString('verknuepfung-id');
    if (titel !== null) input.titel = titel;
    if (beschreibung !== null) input.beschreibung = beschreibung;
    if (fach !== null) input.fach = fach;
    if (kategorie !== null) input.kategorie = kategorie;
    if (url !== null) input.url = url;
    if (datei !== null)
      input.anhang = { url: datei.url, name: datei.name, contentType: datei.contentType };
    if (verknuepfungTyp !== null) input.verknuepfungTyp = verknuepfungTyp;
    if (verknuepfungId !== null) input.verknuepfungId = verknuepfungId;

    const material = await updateLearningMaterialForClass(
      guildConfig,
      member,
      materialId,
      input,
      interaction.user.id,
    );

    await interaction.reply({
      content: `📚 Lernmaterial **${material.title}** wurde aktualisiert.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

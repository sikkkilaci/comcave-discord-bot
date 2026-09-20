import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { importCoursePlanForClass } from '../../../services/coursePlanImportService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kursplan-importieren')
    .setDescription(
      'Importiert Kursplandaten einer Klasse aus der versionierten Quelldatei (nur Admins).',
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die importiert werden soll')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const result = await importCoursePlanForClass(
      guildConfig,
      member,
      className,
      interaction.user.id,
    );

    await interaction.reply({
      content:
        `Kursplan ${CLASS_NAME_LABELS[className]} importiert (Quelle: \`${result.sourceFile}\`): ` +
        `${result.coursesCreated} Kurse neu, ${result.coursesUpdated} aktualisiert, ` +
        `${result.specialDaysCreated} besondere Termine neu, ${result.specialDaysUpdated} aktualisiert.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

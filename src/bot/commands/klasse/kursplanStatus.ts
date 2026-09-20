import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getCoursePlanStatusForClass } from '../../../services/coursePlanService.js';
import { buildCoursePlanStatusEmbed } from '../../ui/coursePlanMessage.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kursplan-status')
    .setDescription(
      'Zeigt aktuellen/naechsten Kurs und Kenntnisnahme-Status einer Klasse (Klassenleitung/Admin).',
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse (Klassenleitung: nur die eigene Klasse; Admin: jede Klasse)')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const requested = interaction.options.getString('klasse', true);

    // Fail-closed: assertClassManagementAccess() in getCoursePlanStatusForClass()
    // verweigert jede Klasse, die weder die eigene Klassenleitung noch Admin ist -
    // eine manipulierte "klasse"-Angabe kann daher nie fremde Daten liefern.
    const status = await getCoursePlanStatusForClass(
      guildConfig,
      member,
      classNameSchema.parse(requested),
    );

    await interaction.reply({
      embeds: [buildCoursePlanStatusEmbed(status)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

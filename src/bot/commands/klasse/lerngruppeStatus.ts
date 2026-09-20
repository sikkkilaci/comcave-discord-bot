import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getStudyGroupStatusForClass } from '../../../services/studyGroupService.js';
import { buildStudyGroupStatusEmbed } from '../../ui/studyGroupMessage.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lerngruppe-status')
    .setDescription('Zeigt alle Lerngruppen einer Klasse inkl. Mitgliedern (Klassenleitung/Admin).')
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

    // Fail-closed: assertClassManagementAccess() in getStudyGroupStatusForClass()
    // verweigert jede Klasse, die weder die eigene Klassenleitung noch Admin ist.
    const status = await getStudyGroupStatusForClass(
      guildConfig,
      member,
      classNameSchema.parse(requested),
    );

    await interaction.reply({
      embeds: [buildStudyGroupStatusEmbed(status.className, status.groups)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;

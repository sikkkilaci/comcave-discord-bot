import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getCoursePlanOverviewForClass } from '../../../services/coursePlanService.js';
import { getCourseContentByCourseNumber } from '../../../services/courseContentService.js';
import { buildCourseContentEmbed } from '../../ui/courseContentMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kursinhalte')
    .setDescription('Zeigt die Kursgliederung eines Kurses (Standard: dein aktueller Kurs).')
    .addStringOption((option) =>
      option
        .setName('kurs')
        .setDescription('Kursnummer (optional, Standard: dein aktueller Kurs)')
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.VERIFIED,
  async execute(interaction) {
    if (!interaction.guild) return;

    const requestedCourseNumber = interaction.options.getString('kurs')?.trim();
    let courseNumber: string;
    let courseTitle: string | null = null;

    if (requestedCourseNumber) {
      courseNumber = requestedCourseNumber;
    } else {
      const member = interaction.member as GuildMember;
      const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
      const overview = await getCoursePlanOverviewForClass(guildConfig, member, null);

      if (!overview.currentEntry) {
        await interaction.reply({
          content:
            'Aktuell läuft kein Kurs. Gib eine Kursnummer an, um gezielt Inhalte anzuzeigen ' +
            '(`/kursinhalte kurs:<Kursnummer>`).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      courseNumber = overview.currentEntry.courseNumber;
      courseTitle = overview.currentEntry.title;
    }

    const items = await getCourseContentByCourseNumber(courseNumber);
    const embed = buildCourseContentEmbed(courseNumber, courseTitle, items);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;

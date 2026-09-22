import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { setupCourseCategories } from '../../../services/courseCategoryService.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-kurskategorien')
    .setDescription(
      '📚 Richtet je Kurs eine Discord-Kategorie mit Zeitraum und Kursinhalten ein (nur Admins).',
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    // Bis zu 34 Kategorien inkl. Kanal und Nachricht - deutlich mehr sequentielle
    // Discord-API-Aufrufe als Discords 3-Sekunden-Fenster fuer die initiale
    // Interaktions-Antwort erlaubt. Defer sofort, siehe setupKlassenbereiche.ts.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const result = await setupCourseCategories(interaction.guild, guildConfig, interaction.user.id);

    const lines = [
      `**Kurs-Kategorien (${result.totalCourses} Kurse, davon ${result.coursesWithExam} mit Klausur ⚠️)**`,
      `- Kategorien neu: ${result.categoriesCreated}`,
      `- Kategorien umbenannt (geaenderter Titel/Klausur-Status): ${result.categoriesRenamed}`,
      `- Kategorien wiederverwendet: ${result.categoriesReused}`,
      `- Kanaele neu: ${result.channelsCreated}`,
      `- Kursinhalte neu gepostet: ${result.contentPosted}`,
      `- Kursinhalte aktualisiert: ${result.contentUpdated}`,
    ];

    await interaction.editReply({ content: lines.join('\n') });
  },
};

export default command;

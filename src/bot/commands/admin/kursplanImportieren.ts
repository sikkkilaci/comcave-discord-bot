import { ChannelType, MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getClassByName } from '../../../repositories/classRepository.js';
import { importCoursePlanForClass } from '../../../services/coursePlanImportService.js';
import { syncClassCoursePlanChannel } from '../../../services/classCoursePlanService.js';
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

    // Der anschliessende Kanal-Sync postet/aktualisiert eine Nachricht je Kurs-Slot (bei
    // Klasse A aktuell ~18) - das kann Discords 3-Sekunden-Fenster fuer die initiale
    // Interaktions-Antwort ueberschreiten. Defer sofort, siehe setupKlassenbereiche.ts.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const result = await importCoursePlanForClass(
      guildConfig,
      member,
      className,
      interaction.user.id,
    );

    let channelSummary =
      'Kein Kursplan-Kanal vorhanden - bitte zuerst `/setup-klassenbereiche` erneut ausführen.';
    const klasse = await getClassByName(interaction.guild.id, className);
    if (klasse?.coursePlanChannelId) {
      const channel = await interaction.guild.channels.fetch(klasse.coursePlanChannelId);
      if (channel?.type === ChannelType.GuildText) {
        const syncResult = await syncClassCoursePlanChannel(channel, klasse.id);
        channelSummary =
          `Kanal #📚-kursplan aktualisiert: ${syncResult.posted} neu gepostet, ` +
          `${syncResult.updated} aktualisiert (${syncResult.total} Kurse insgesamt).`;
      }
    }

    await interaction.editReply({
      content:
        `Kursplan ${CLASS_NAME_LABELS[className]} importiert (Quelle: \`${result.sourceFile}\`): ` +
        `${result.coursesCreated} Kurse neu, ${result.coursesUpdated} aktualisiert, ` +
        `${result.specialDaysCreated} besondere Termine neu, ${result.specialDaysUpdated} aktualisiert.\n` +
        channelSummary,
    });
  },
};

export default command;

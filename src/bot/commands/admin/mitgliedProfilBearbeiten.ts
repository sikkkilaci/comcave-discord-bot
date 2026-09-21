import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import {
  formatLocationLabel,
  searchActiveLocations,
} from '../../../repositories/locationRepository.js';
import { updatePersonalDetailsAsAdmin } from '../../../services/memberProfileService.js';
import { MAX_AGE, MIN_AGE, PERSON_NAME_MAX_LENGTH } from '../../../types/domain.js';

const MAX_AUTOCOMPLETE_RESULTS = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mitglied-profil-bearbeiten')
    .setDescription('📝 Kontrollierte Korrektur der Pflichtangaben eines Mitglieds (nur Admins).')
    .addUserOption((option) =>
      option.setName('mitglied').setDescription('Zu bearbeitendes Mitglied').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('vorname')
        .setDescription('Neuer Vorname')
        .setRequired(false)
        .setMaxLength(PERSON_NAME_MAX_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName('nachname')
        .setDescription('Neuer Nachname')
        .setRequired(false)
        .setMaxLength(PERSON_NAME_MAX_LENGTH),
    )
    .addIntegerOption((option) =>
      option
        .setName('alter')
        .setDescription('Neues Alter')
        .setRequired(false)
        .setMinValue(MIN_AGE)
        .setMaxValue(MAX_AGE),
    )
    .addStringOption((option) =>
      option
        .setName('standort')
        .setDescription('Neuer COMCAVE-Standort (Suche)')
        .setRequired(false)
        .setAutocomplete(true),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetMember = interaction.options.getMember('mitglied') as GuildMember | null;
    if (!targetMember) {
      await interaction.reply({
        content: 'Dieses Mitglied konnte nicht gefunden werden (evtl. nicht mehr auf dem Server).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const actingMember = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    const vorname = interaction.options.getString('vorname');
    const nachname = interaction.options.getString('nachname');
    const alter = interaction.options.getInteger('alter');
    const standortId = interaction.options.getString('standort');

    const result = await updatePersonalDetailsAsAdmin(
      guildConfig,
      actingMember,
      targetMember,
      {
        ...(vorname !== null ? { vorname } : {}),
        ...(nachname !== null ? { nachname } : {}),
        ...(alter !== null ? { alter } : {}),
        ...(standortId !== null ? { standortId } : {}),
      },
      interaction.user.id,
    );

    const nicknameNote = result.nicknameSkipped
      ? ' (Server-Nickname konnte nicht automatisch aktualisiert werden - fehlende Berechtigung.)'
      : result.nicknameChanged
        ? ' Server-Nickname wurde aktualisiert.'
        : '';

    await interaction.reply({
      content: `Profil von ${targetMember} wurde aktualisiert.${nicknameNote}`,
      flags: MessageFlags.Ephemeral,
    });
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const results = await searchActiveLocations(focused, MAX_AUTOCOMPLETE_RESULTS);

    await interaction.respond(
      results.map((location) => ({
        name: formatLocationLabel(location).slice(0, MAX_CHOICE_NAME_LENGTH),
        value: location.id,
      })),
    );
  },
};

export default command;

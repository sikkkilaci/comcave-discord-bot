import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { searchActiveLocations } from '../../../repositories/locationRepository.js';
import {
  completeProfileAndSetNickname,
  selectLocation,
} from '../../../services/memberProfileService.js';
import { buildSafeNextStepReplyPart } from '../../journeyFlow.js';

/** Discord erlaubt maximal 25 Autocomplete-Vorschlaege und 100 Zeichen je Anzeigename. */
const MAX_AUTOCOMPLETE_RESULTS = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('standort-waehlen')
    .setDescription('📍 Waehlt deinen COMCAVE-Standort (Pflichtangabe im Teilnehmerprofil).')
    .addStringOption((option) =>
      option
        .setName('standort')
        .setDescription('Suche nach Standortname, Stadt oder PLZ')
        .setRequired(true)
        .setAutocomplete(true),
    ),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    if (!interaction.guild) return;

    const locationId = interaction.options.getString('standort', true);
    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);

    await selectLocation(guildConfig, member, locationId, member.id);
    const completion = await completeProfileAndSetNickname(guildConfig, member, member.id);

    const prefix = completion.nicknameSkipped
      ? '✅ Standort gespeichert. Dein Server-Nickname konnte nicht automatisch gesetzt werden ' +
        '(fehlende Berechtigung) - bitte wende dich an einen Admin.'
      : `✅ Standort gespeichert. Dein Server-Nickname wurde auf "${completion.nickname}" gesetzt.`;

    const nextPart = await buildSafeNextStepReplyPart(interaction.guild.id, member.id);

    await interaction.reply({
      content: [prefix, nextPart.content].filter(Boolean).join('\n\n'),
      embeds: nextPart.embeds ?? [],
      components: nextPart.components ?? [],
      flags: MessageFlags.Ephemeral,
    });
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const results = await searchActiveLocations(focused, MAX_AUTOCOMPLETE_RESULTS);

    await interaction.respond(
      results.map((location) => ({
        name: `${location.name} - ${location.city} (${location.postalCode})`.slice(
          0,
          MAX_CHOICE_NAME_LENGTH,
        ),
        value: location.id,
      })),
    );
  },
};

export default command;

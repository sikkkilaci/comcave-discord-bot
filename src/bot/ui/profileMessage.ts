import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { MAX_AGE, MIN_AGE, PERSON_NAME_MAX_LENGTH } from '../../types/domain.js';

export const PROFILE_DETAILS_BUTTON_CUSTOM_ID = 'profile:start-details';
export const PROFILE_DETAILS_MODAL_CUSTOM_ID = 'profile:details-modal';
export const PROFILE_DETAILS_INPUT_IDS = {
  vorname: 'vorname',
  nachname: 'nachname',
  alter: 'alter',
} as const;

export interface ProfileMessagePayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Aufforderung, die Pflichtangaben auszufuellen - oeffnet per Button-Klick
 * das Modal (buildProfileDetailsModal()). Discord erlaubt kein Modal als
 * direkte Erstantwort auf ein guildMemberAdd-Event, daher der Umweg ueber
 * einen Button.
 */
export function buildProfileDetailsPromptMessage(): ProfileMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('📝 Teilnehmerprofil')
    .setDescription(
      'Bevor es weitergeht, brauchen wir noch ein paar Pflichtangaben von dir: Vorname, ' +
        'Nachname, Alter und dein COMCAVE-Standort. Dein Vor- und Nachname wird anschliessend ' +
        'als dein Server-Nickname gesetzt - dein Discord-Benutzername bleibt dabei unveraendert.',
    )
    .setColor(0x2b2d31);

  const button = new ButtonBuilder()
    .setCustomId(PROFILE_DETAILS_BUTTON_CUSTOM_ID)
    .setLabel('Angaben machen')
    .setEmoji('📝')
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

/** Baut das Modal fuer Vorname/Nachname/Alter (Discord unterstuetzt darin keine Auswahllisten). */
export function buildProfileDetailsModal(): ModalBuilder {
  const vorname = new TextInputBuilder()
    .setCustomId(PROFILE_DETAILS_INPUT_IDS.vorname)
    .setLabel('Vorname')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(PERSON_NAME_MAX_LENGTH)
    .setRequired(true);

  const nachname = new TextInputBuilder()
    .setCustomId(PROFILE_DETAILS_INPUT_IDS.nachname)
    .setLabel('Nachname')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(PERSON_NAME_MAX_LENGTH)
    .setRequired(true);

  const alter = new TextInputBuilder()
    .setCustomId(PROFILE_DETAILS_INPUT_IDS.alter)
    .setLabel(`Alter (${MIN_AGE}-${MAX_AGE})`)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(3)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(PROFILE_DETAILS_MODAL_CUSTOM_ID)
    .setTitle('Persoenliche Angaben')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(vorname),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nachname),
      new ActionRowBuilder<TextInputBuilder>().addComponents(alter),
    );
}

/** Bestaetigung nach dem Modal-Submit - verweist auf den naechsten Schritt (/standort-waehlen). */
export function buildProfileDetailsSavedMessage(): ProfileMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('✅ Angaben gespeichert')
    .setDescription(
      'Vorname, Nachname und Alter wurden gespeichert. Bitte waehle jetzt noch deinen ' +
        'COMCAVE-Standort mit `/standort-waehlen` aus.',
    )
    .setColor(0x2b2d31);

  return { embeds: [embed], components: [] };
}

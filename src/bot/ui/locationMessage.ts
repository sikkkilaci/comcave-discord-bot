import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ComcaveLocation } from '@prisma/client';
import { formatLocationLabel } from '../../repositories/locationRepository.js';

/**
 * Standort-Auswahl per Klick statt per Slash-Befehl (`/standort-waehlen`
 * bleibt zusaetzlich als Fallback bestehen): Button oeffnet ein Modal mit
 * einem Suchbegriff (Stadt/PLZ/Name), danach entweder direkte Uebernahme
 * (genau ein Treffer) oder eine Auswahlliste (mehrere Treffer) - siehe
 * interactionCreate.ts. Discord erlaubt kein Modal als direkte Erstantwort
 * auf ein guildMemberAdd-Event, daher derselbe Button-Umweg wie beim
 * Namens-Modal (siehe profileMessage.ts).
 */
export const LOCATION_SEARCH_BUTTON_CUSTOM_ID = 'profile:start-location';
export const LOCATION_SEARCH_MODAL_CUSTOM_ID = 'profile:location-modal';
export const LOCATION_SEARCH_INPUT_ID = 'suchbegriff';
export const LOCATION_SELECT_CUSTOM_ID = 'profile:location-select';

/** Discord erlaubt maximal 25 Optionen in einem String-Select-Menu. */
export const MAX_LOCATION_CHOICES = 25;

export interface LocationMessagePayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
}

export function buildLocationPromptMessage(): LocationMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('📍 COMCAVE-Standort')
    .setDescription('Bitte waehle jetzt noch deinen COMCAVE-Standort aus.')
    .setColor(0x2b2d31);

  const button = new ButtonBuilder()
    .setCustomId(LOCATION_SEARCH_BUTTON_CUSTOM_ID)
    .setLabel('Standort waehlen')
    .setEmoji('📍')
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

export function buildLocationSearchModal(): ModalBuilder {
  const suchbegriff = new TextInputBuilder()
    .setCustomId(LOCATION_SEARCH_INPUT_ID)
    .setLabel('Stadt, PLZ oder Standortname')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(LOCATION_SEARCH_MODAL_CUSTOM_ID)
    .setTitle('Standort suchen')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(suchbegriff));
}

/** Kein Treffer fuer den Suchbegriff - Aufforderung, es erneut zu versuchen. */
export function buildNoLocationMatchesMessage(query: string): LocationMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('Kein Standort gefunden')
    .setDescription(
      `Fuer "${query}" wurde kein aktiver Standort gefunden. Bitte versuche es mit einer ` +
        'anderen Schreibweise (z. B. nur die Stadt) oder wende dich an einen Admin.',
    )
    .setColor(0xda373c);

  return { embeds: [embed], components: [] };
}

/** Zu viele Treffer fuer eine sinnvolle Auswahlliste (> 25) - engere Suche noetig. */
export function buildTooManyLocationMatchesMessage(
  query: string,
  count: number,
): LocationMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('Zu viele Treffer')
    .setDescription(
      `Fuer "${query}" wurden ${count} Standorte gefunden - bitte grenze deine Suche weiter ein ` +
        '(z. B. mit der Postleitzahl).',
    )
    .setColor(0xda373c);

  return { embeds: [embed], components: [] };
}

/** Mehrere Treffer - Auswahlliste zum Anklicken. */
export function buildLocationChoicesMessage(locations: ComcaveLocation[]): LocationMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('📍 Standort auswaehlen')
    .setDescription('Waehle deinen Standort aus der Liste.')
    .setColor(0x2b2d31);

  const select = new StringSelectMenuBuilder()
    .setCustomId(LOCATION_SELECT_CUSTOM_ID)
    .setPlaceholder('Standort waehlen')
    .addOptions(
      locations.map((location) => ({
        label: formatLocationLabel(location).slice(0, 100),
        value: location.id,
      })),
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

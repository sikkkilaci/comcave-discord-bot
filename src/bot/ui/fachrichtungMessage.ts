import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { FACHRICHTUNGEN, FACHRICHTUNG_LABELS, type Fachrichtung } from '../../types/domain.js';

/** Prefix der Button-customId; das Suffix ist die jeweilige Fachrichtung. */
export const FACHRICHTUNG_SELECT_CUSTOM_ID_PREFIX = 'fachrichtung:select:';

export function buildFachrichtungCustomId(value: Fachrichtung): string {
  return `${FACHRICHTUNG_SELECT_CUSTOM_ID_PREFIX}${value}`;
}

export function parseFachrichtungCustomId(customId: string): Fachrichtung | null {
  if (!customId.startsWith(FACHRICHTUNG_SELECT_CUSTOM_ID_PREFIX)) return null;
  const value = customId.slice(FACHRICHTUNG_SELECT_CUSTOM_ID_PREFIX.length);
  return (FACHRICHTUNGEN as readonly string[]).includes(value) ? (value as Fachrichtung) : null;
}

export interface FachrichtungMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Baut die Fachrichtungs-Auswahl im Eintrittsflow: Embed + ein Button je
 * Fachrichtung. Anders als bei der Klassenwahl gibt es hier keine
 * "aktuelle Auswahl hervorheben"-Logik, da dieser Schritt nur einmal (vor
 * der Klassenwahl) durchlaufen wird.
 */
export function buildFachrichtungMessage(): FachrichtungMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('Welche Fachrichtung machst du? 🎓')
    .setDescription('Waehle deine IHK-Fachrichtung. Diese Auswahl ist einmalig.')
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    FACHRICHTUNGEN.map((value) =>
      new ButtonBuilder()
        .setCustomId(buildFachrichtungCustomId(value))
        .setLabel(FACHRICHTUNG_LABELS[value])
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: [row] };
}

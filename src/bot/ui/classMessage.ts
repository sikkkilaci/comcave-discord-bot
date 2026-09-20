import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';

/** Prefix der Button-customId; das Suffix ist der jeweilige Klassenname (A/B/C). */
export const CLASS_SELECT_CUSTOM_ID_PREFIX = 'class:select:';

export function buildClassCustomId(name: ClassName): string {
  return `${CLASS_SELECT_CUSTOM_ID_PREFIX}${name}`;
}

export function parseClassCustomId(customId: string): ClassName | null {
  if (!customId.startsWith(CLASS_SELECT_CUSTOM_ID_PREFIX)) return null;
  const value = customId.slice(CLASS_SELECT_CUSTOM_ID_PREFIX.length);
  return (CLASS_NAMES as readonly string[]).includes(value) ? (value as ClassName) : null;
}

export interface ClassMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Baut die zentrale #wo-bin-ich-Nachricht: Embed + ein Button je Klasse.
 * Wird sowohl als dauerhafte Kanal-Nachricht (per /setup-klassen gepostet)
 * als auch als Antwort auf /wo-bin-ich verwendet - derselbe Rendering-Pfad
 * fuer Erstauswahl, erneutes Aufrufen und Klassenwechsel. Die aktuelle
 * Klasse (falls vorhanden) wird optisch hervorgehoben.
 */
export function buildClassSelectionMessage(
  currentClassName: ClassName | null,
): ClassMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('Wo bin ich? 🧭')
    .setDescription(
      'Waehle deine Klasse aus, um Zugriff auf deinen Klassenbereich 🏫 zu erhalten. ' +
        'Ein Wechsel ist jederzeit moeglich - die alte Klassenrolle wird dabei automatisch entfernt.',
    )
    .setColor(0x2b2d31)
    .setFooter({
      text: currentClassName
        ? `Aktuelle Klasse: ${CLASS_NAME_LABELS[currentClassName]}`
        : 'Du bist noch keiner Klasse zugeordnet.',
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    CLASS_NAMES.map((name) =>
      new ButtonBuilder()
        .setCustomId(buildClassCustomId(name))
        .setLabel(CLASS_NAME_LABELS[name])
        .setStyle(name === currentClassName ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: [row] };
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from 'discord.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import type { ClassMemberOverview } from '../../services/classService.js';

/** Prefix der Button-customId der Uebersicht; das Suffix ist der jeweilige Klassenname (A/B/C). */
export const CLASS_SELECT_CUSTOM_ID_PREFIX = 'class:select:';
/** Prefix der Button-customId der expliziten Bestaetigung (siehe buildClassConfirmMessage()). */
export const CLASS_CONFIRM_CUSTOM_ID_PREFIX = 'class:confirm:';
/** "Zurueck zur Klassenauswahl" auf dem Bestaetigungs-Screen - verwirft die Auswahl. */
export const CLASS_BACK_CUSTOM_ID = 'class:back';
/** "Klasse nicht erkannt / Hilfe" auf der Uebersicht. */
export const CLASS_HELP_CUSTOM_ID = 'class:help';

/** Discord-Embed-Feldwerte vertragen bis zu 1024 Zeichen; mehr Namen werden zusammengefasst. */
const MAX_NAMES_SHOWN = 15;

export function buildClassCustomId(name: ClassName): string {
  return `${CLASS_SELECT_CUSTOM_ID_PREFIX}${name}`;
}

export function parseClassCustomId(customId: string): ClassName | null {
  if (!customId.startsWith(CLASS_SELECT_CUSTOM_ID_PREFIX)) return null;
  const value = customId.slice(CLASS_SELECT_CUSTOM_ID_PREFIX.length);
  return (CLASS_NAMES as readonly string[]).includes(value) ? (value as ClassName) : null;
}

export function buildClassConfirmCustomId(name: ClassName): string {
  return `${CLASS_CONFIRM_CUSTOM_ID_PREFIX}${name}`;
}

export function parseClassConfirmCustomId(customId: string): ClassName | null {
  if (!customId.startsWith(CLASS_CONFIRM_CUSTOM_ID_PREFIX)) return null;
  const value = customId.slice(CLASS_CONFIRM_CUSTOM_ID_PREFIX.length);
  return (CLASS_NAMES as readonly string[]).includes(value) ? (value as ClassName) : null;
}

export interface ClassMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Formatiert die Vornamen einer Klasse fuer ein Embed-Feld: escaped (gegen
 * Markdown-Injection ueber einen frei eingegebenen Vornamen), auf
 * MAX_NAMES_SHOWN begrenzt (mit "+N weitere"-Hinweis, damit eine sehr grosse
 * Klasse das Discord-UI nicht sprengt) und mit einem eindeutigen Hinweistext
 * fuer eine (noch) leere Klasse.
 */
function formatMemberNames(names: readonly string[]): string {
  if (names.length === 0) {
    return '*Noch keine bestätigten Teilnehmer.*';
  }

  const shown = names.slice(0, MAX_NAMES_SHOWN).map((name) => escapeMarkdown(name));
  const remaining = names.length - shown.length;

  return remaining > 0 ? `${shown.join('\n')}\n*+${remaining} weitere*` : shown.join('\n');
}

/**
 * Baut die zentrale #wo-bin-ich-Uebersicht: eine Spalte je Klasse mit den
 * Vornamen der bereits BESTAETIGTEN Teilnehmer (siehe
 * classService.getConfirmedClassOverview() - zeigt nie blosse
 * Onboarding-Angaben oder unbestaetigte Zuordnungen), darunter ein Button je
 * Klasse sowie ein Hilfe-Button fuer den Fall, dass die eigene Klasse nicht
 * erkannt wird. Ein Klick auf einen Klassen-Button uebernimmt NICHTS direkt -
 * er fuehrt erst zum Bestaetigungs-Screen (buildClassConfirmMessage()).
 * Wird sowohl als dauerhafte Kanal-Nachricht (per /setup-server gepostet) als
 * auch als Antwort auf /wo-bin-ich verwendet.
 */
export function buildClassSelectionMessage(
  overview: ClassMemberOverview,
  currentClassName: ClassName | null,
): ClassMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('🏫 Erkennst du deine Klasse wieder?')
    .setDescription(
      'Hier siehst du, wer sich in welcher Klasse bereits bestätigt hat. Wähle unten deine ' +
        'Klasse aus - danach musst du sie noch einmal ausdrücklich bestätigen. **Diese Wahl ist ' +
        'einmalig** - für einen Wechsel wende dich an deine Klassenleitung oder die Verwaltung.\n\n' +
        '❓ Du erkennst deine Klasse nicht? Klicke unten auf Hilfe.',
    )
    .addFields(
      CLASS_NAMES.map((name) => ({
        name: CLASS_NAME_LABELS[name],
        value: formatMemberNames(overview[name]),
        inline: true,
      })),
    )
    .setColor(0x2b2d31)
    .setFooter({
      text: currentClassName
        ? `Aktuelle Klasse: ${CLASS_NAME_LABELS[currentClassName]}`
        : 'Du bist noch keiner Klasse zugeordnet.',
    });

  const classRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    CLASS_NAMES.map((name) =>
      new ButtonBuilder()
        .setCustomId(buildClassCustomId(name))
        .setLabel(CLASS_NAME_LABELS[name])
        .setStyle(name === currentClassName ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );

  const helpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CLASS_HELP_CUSTOM_ID)
      .setLabel('Klasse nicht erkannt / Hilfe')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [classRow, helpRow] };
}

/**
 * Bestaetigungs-Screen nach dem (noch unverbindlichen) Klick auf eine Klasse:
 * zeigt die dortigen bestaetigten Teilnehmer erneut, aber persistiert NICHTS.
 * Erst ein Klick auf "Ja, das ist meine Klasse" (buildClassConfirmCustomId())
 * ruft tatsaechlich assignClass() auf; "Zurueck" (CLASS_BACK_CUSTOM_ID) fuehrt
 * ohne jede Aenderung zur Uebersicht zurueck.
 */
export function buildClassConfirmMessage(
  className: ClassName,
  memberNames: readonly string[],
): ClassMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle(`🔎 ${CLASS_NAME_LABELS[className]} ausgewählt`)
    .setDescription(
      `Du hast **${CLASS_NAME_LABELS[className]}** ausgewählt.\n\n` +
        'In dieser Klasse befinden sich aktuell:\n' +
        `${formatMemberNames(memberNames)}\n\n` +
        '❓ Bist du dir sicher, dass dies deine Klasse ist?',
    )
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildClassConfirmCustomId(className))
      .setLabel('Ja, das ist meine Klasse')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CLASS_BACK_CUSTOM_ID)
      .setLabel('Zurück zur Klassenauswahl')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

/** Bestaetigung nach einer Hilfe-Anfrage (siehe classService.requestClassHelp()). */
export function buildClassHelpRequestedMessage(): ClassMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Hilfe angefragt')
    .setDescription(
      'Danke! Deine Klassenleitung bzw. die Verwaltung wurde informiert und meldet sich bei ' +
        'dir, sobald geklärt ist, in welche Klasse du gehörst. Bis dahin hast du bereits ' +
        'Zugriff auf den 🏫 Schulhof.',
    )
    .setColor(0x2b2d31);

  return { embeds: [embed], components: [] };
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from 'discord.js';
import type { CourseEntry } from '@prisma/client';
import type {
  CoursePlanOverviewResult,
  CoursePlanStatusResult,
} from '../../services/coursePlanService.js';
import { CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import { formatGermanDate } from '../../utils/dateTime.js';

/** Prefix der "Kenntnis genommen"-Button-customId; das Suffix ist die Kurs-ID. */
export const COURSE_PLAN_ACK_CUSTOM_ID_PREFIX = 'coursePlan:ack:';

export function buildCoursePlanAckCustomId(courseEntryId: string): string {
  return `${COURSE_PLAN_ACK_CUSTOM_ID_PREFIX}${courseEntryId}`;
}

export function parseCoursePlanAckCustomId(customId: string): string | null {
  if (!customId.startsWith(COURSE_PLAN_ACK_CUSTOM_ID_PREFIX)) return null;
  const courseEntryId = customId.slice(COURSE_PLAN_ACK_CUSTOM_ID_PREFIX.length);
  return courseEntryId || null;
}

/** Discord erlaubt maximal 1024 Zeichen je Embed-Feld. */
const MAX_FIELD_LENGTH = 1024;

function courseLine(entry: CourseEntry): string {
  const lines = [
    `Kursnummer: \`${entry.courseNumber}\``,
    `Zeitraum: ${formatGermanDate(entry.startDate)} - ${formatGermanDate(entry.endDate)}`,
    `Dozent: ${entry.trainer ?? 'nicht angegeben'}`,
  ];
  return lines.join('\n');
}

export interface CoursePlanOverviewMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Baut die persoenliche Kursplan-Uebersicht fuer `/kursplan`. Zeigt fuer eine
 * Klasse ohne eigene Kursplan-Daten (aktuell B/C) ausdruecklich einen
 * Status-Hinweis statt der Daten von Klasse A - siehe hasOwnPlan-Zweig.
 */
export function buildCoursePlanOverviewMessage(
  overview: CoursePlanOverviewResult,
): CoursePlanOverviewMessage {
  const embed = new EmbedBuilder()
    .setTitle(`Kursplan - ${CLASS_NAME_LABELS[overview.className]}`)
    .setColor(0x2b2d31)
    .setFooter({ text: `ISO-Kalenderwoche ${overview.isoWeek}/${overview.isoWeekYear}` });

  if (!overview.hasOwnPlan) {
    embed.setDescription(
      [
        'Für deine Klasse liegt aktuell noch kein eigener Kursplan vor.',
        'Der aktuell vorhandene Kursplan für Klasse A dient nur als Vorschau/Beispiel und ist ' +
          `für Klasse ${overview.className} NICHT verbindlich.`,
        'Bitte wende dich an deine Klassenleitung bzw. OverHead, damit die Kursplandaten deiner ' +
          'Klasse an die Administration übermittelt werden können.',
      ].join('\n\n'),
    );
    return { embeds: [embed], components: [] };
  }

  if (overview.currentSpecialDay) {
    embed.addFields({ name: 'Hinweis', value: overview.currentSpecialDay.label });
  }

  if (overview.currentEntry) {
    const ackNote = overview.currentEntryAcknowledgedAt
      ? `\nKenntnisnahme bestätigt am ${formatGermanDate(overview.currentEntryAcknowledgedAt)}.`
      : '';
    embed.addFields({
      name: `Aktueller Kurs: ${overview.currentEntry.title}`,
      value: (courseLine(overview.currentEntry) + ackNote).slice(0, MAX_FIELD_LENGTH),
    });
  } else {
    embed.addFields({ name: 'Aktueller Kurs', value: 'Aktuell findet kein Kurs statt.' });
  }

  if (overview.nextEntry) {
    embed.addFields({
      name: `Nächster Kurs: ${overview.nextEntry.title}`,
      value: courseLine(overview.nextEntry).slice(0, MAX_FIELD_LENGTH),
    });
  } else {
    embed.addFields({ name: 'Nächster Kurs', value: 'Kein weiterer Kurs eingetragen.' });
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (overview.currentEntry && !overview.currentEntryAcknowledgedAt) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCoursePlanAckCustomId(overview.currentEntry.id))
          .setLabel('Kenntnis genommen')
          .setStyle(ButtonStyle.Success),
      ),
    );
  }

  return { embeds: [embed], components };
}

/** Baut die Kenntnisnahme-Statusanzeige fuer Klassenleitung/Admin (`/kursplan-status`). */
export function buildCoursePlanStatusEmbed(status: CoursePlanStatusResult): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Kursplan-Status - ${CLASS_NAME_LABELS[status.className]}`)
    .setColor(0x2b2d31);

  const fields: APIEmbedField[] = [];

  fields.push({
    name: 'Aktueller Kurs',
    value: status.currentEntry
      ? `${status.currentEntry.title}\n${courseLine(status.currentEntry)}`
      : 'Aktuell findet kein Kurs statt.',
  });

  fields.push({
    name: 'Nächster Kurs',
    value: status.nextEntry
      ? `${status.nextEntry.title}\n${courseLine(status.nextEntry)}`
      : 'Kein weiterer Kurs eingetragen.',
  });

  if (status.currentEntry) {
    fields.push({
      name: `Kenntnisnahme bestätigt (${status.acknowledgedDiscordIds.length})`,
      value: status.acknowledgedDiscordIds.length
        ? status.acknowledgedDiscordIds
            .map((id) => `<@${id}>`)
            .join(', ')
            .slice(0, MAX_FIELD_LENGTH)
        : 'Noch niemand.',
    });
    fields.push({
      name: `Kenntnisnahme ausstehend (${status.pendingDiscordIds.length})`,
      value: status.pendingDiscordIds.length
        ? status.pendingDiscordIds
            .map((id) => `<@${id}>`)
            .join(', ')
            .slice(0, MAX_FIELD_LENGTH)
        : 'Niemand ausstehend.',
    });
  }

  embed.addFields(fields);
  return embed;
}

/** Baut den 7-Tage-Hinweis, der bei einem neu erkannten anstehenden Kurs in den Klassen-Ankuendigungen gepostet wird. */
export function buildUpcomingCourseNoticeEmbed(
  className: ClassName,
  entry: CourseEntry,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Neuer Kurs in Kürze - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31)
    .setDescription(`**${entry.title}**\n${courseLine(entry)}`)
    .setFooter({ text: 'Details siehe /kursplan' });
}

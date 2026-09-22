import { EmbedBuilder } from 'discord.js';
import type { CourseContentItem, CourseEntry } from '@prisma/client';
import { formatContentLine } from './courseContentMessage.js';
import { formatGermanDate } from '../../utils/dateTime.js';

/** Discord erlaubt maximal 4096 Zeichen in einer Embed-Beschreibung. */
const MAX_DESCRIPTION_LENGTH = 4096;

/**
 * Eingebettet im Footer, damit syncClassCoursePlanChannel() eine bereits
 * gepostete Nachricht zu einem CourseEntry wiederfindet (Discord bietet
 * keine eigene Nachrichten-Metadaten-API) und beim naechsten Sync-Lauf
 * editiert statt dupliziert.
 */
export function buildClassCoursePlanFooterText(
  entry: Pick<CourseEntry, 'id' | 'courseNumber'>,
): string {
  return `Kursnummer: ${entry.courseNumber} · ID: ${entry.id}`;
}

/**
 * Baut die Kursplan-Nachricht eines einzelnen Kurs-Slots (CourseEntry) fuer
 * den automatisch synchronisierten #-kursplan-Kanal der Klasse (siehe
 * classCoursePlanService.ts) - Titel, Zeitraum, Dozent, ein deutlicher
 * Klausur-Hinweis (falls erkannt) sowie die vollstaendige Kursgliederung aus
 * CourseContentItem, in derselben Formatierung wie `/kursinhalte`
 * (formatContentLine()).
 */
export function buildClassCoursePlanEmbed(
  entry: CourseEntry,
  hasExam: boolean,
  contentItems: CourseContentItem[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(hasExam ? `⚠️ ${entry.title}` : entry.title)
    .setColor(hasExam ? 0xed4245 : 0x2b2d31)
    .addFields(
      {
        name: 'Zeitraum',
        value: `${formatGermanDate(entry.startDate)} – ${formatGermanDate(entry.endDate)}`,
      },
      { name: 'Dozent', value: entry.trainer ?? 'nicht angegeben' },
    )
    .setFooter({ text: buildClassCoursePlanFooterText(entry) });

  if (hasExam) {
    embed.addFields({
      name: 'Hinweis',
      value: '⚠️ In diesem Kurs findet laut Kursinhalte-Quelle eine Klausur statt.',
    });
  }

  if (contentItems.length === 0) {
    embed.setDescription(
      'Für diesen Kurs sind noch keine Kursinhalte hinterlegt (entweder laut Quelle keine ' +
        'Inhalte vorgesehen, oder die Kursinhalte wurden für diese Kursnummer noch nicht ' +
        'importiert).',
    );
    return embed;
  }

  const lines = contentItems.map(formatContentLine).join('\n');
  embed.setDescription(
    lines.length > MAX_DESCRIPTION_LENGTH
      ? `${lines.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
      : lines,
  );
  return embed;
}

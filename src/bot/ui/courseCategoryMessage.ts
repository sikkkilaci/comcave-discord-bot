import { EmbedBuilder } from 'discord.js';
import type { CourseCatalogEntry } from '../../services/courseCategoryService.js';
import { formatContentLine } from './courseContentMessage.js';
import { formatGermanDate } from '../../utils/dateTime.js';

/** Discord erlaubt maximal 4096 Zeichen in einer Embed-Beschreibung. */
const MAX_DESCRIPTION_LENGTH = 4096;

/**
 * Baut die Kursinhalte-Nachricht, die in der Kurs-Kategorie eines Kurses
 * (siehe courseCategoryService.ts) einmalig gepostet und bei jedem erneuten
 * `/setup-kurskategorien`-Lauf aktualisiert wird - zeigt Titel, Zeitraum
 * (frisch aus der Quelldatei, siehe loadCourseSchedule()), einen deutlichen
 * Klausur-Hinweis (falls erkannt) sowie die vollstaendige Kursgliederung, in
 * derselben Formatierung wie `/kursinhalte` (formatContentLine()).
 */
export function buildCourseCategoryEmbed(entry: CourseCatalogEntry): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(entry.hasExam ? `⚠️ ${entry.courseTitle}` : entry.courseTitle)
    .setColor(entry.hasExam ? 0xed4245 : 0x2b2d31)
    .addFields({
      name: 'Zeitraum',
      value: `${formatGermanDate(entry.start)} – ${formatGermanDate(entry.end)}`,
    })
    .setFooter({
      text: `Kursnummer: ${entry.courseNumber} · vollstaendige Gliederung: /kursinhalte`,
    });

  if (entry.hasExam) {
    embed.addFields({
      name: 'Hinweis',
      value: '⚠️ In diesem Kurs findet laut Kursinhalte-Quelle eine Klausur statt.',
    });
  }

  if (entry.contentItems.length === 0) {
    embed.setDescription(
      'Für diesen Kurs sind noch keine Kursinhalte hinterlegt (entweder laut Quelle keine ' +
        'Inhalte vorgesehen, oder die Kursinhalte wurden für diese Kursnummer noch nicht ' +
        'importiert).',
    );
    return embed;
  }

  const lines = entry.contentItems.map(formatContentLine).join('\n');
  embed.setDescription(
    lines.length > MAX_DESCRIPTION_LENGTH
      ? `${lines.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
      : lines,
  );
  return embed;
}

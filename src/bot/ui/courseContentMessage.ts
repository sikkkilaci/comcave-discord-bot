import { EmbedBuilder } from 'discord.js';
import type { CourseContentItem } from '@prisma/client';

/** Discord erlaubt maximal 4096 Zeichen in einer Embed-Beschreibung. */
const MAX_DESCRIPTION_LENGTH = 4096;

/** Rueckt einen Inhaltseintrag entsprechend seiner Hierarchieebene ein (level 1 = keine Einrueckung). */
function formatContentLine(item: CourseContentItem): string {
  const indent = '　'.repeat(Math.max(item.level - 1, 0));
  return `${indent}${item.numberPath}. ${item.text}`;
}

/**
 * Baut die Kursinhalte-Anzeige fuer `/kursinhalte`: die hierarchisch
 * nummerierte Gliederung eines Kurses als eine Embed-Beschreibung, in der
 * Reihenfolge, in der sie importiert wurden (siehe listCourseContentByCourseNumber()).
 * Ein Kurs ohne Inhalte (leeres `items`) zeigt einen erklaerenden Hinweis statt
 * einer leeren Nachricht - deckt sowohl "laut Quelle keine Inhalte" als auch
 * "noch nicht importiert" ab (courseContentService.ts unterscheidet das
 * bewusst nicht, siehe dort).
 */
export function buildCourseContentEmbed(
  courseNumber: string,
  courseTitle: string | null,
  items: CourseContentItem[],
): EmbedBuilder {
  const title = courseTitle ?? items[0]?.courseTitle ?? `Kurs ${courseNumber}`;
  const embed = new EmbedBuilder()
    .setTitle(`Kursinhalte - ${title}`)
    .setColor(0x2b2d31)
    .setFooter({ text: `Kursnummer: ${courseNumber}` });

  if (items.length === 0) {
    embed.setDescription(
      'Für diesen Kurs sind noch keine Inhalte hinterlegt (entweder laut Quelle keine ' +
        'Inhalte vorgesehen, oder die Kursinhalte wurden für diese Kursnummer noch nicht ' +
        'importiert).',
    );
    return embed;
  }

  const lines = items.map(formatContentLine).join('\n');
  embed.setDescription(
    lines.length > MAX_DESCRIPTION_LENGTH
      ? `${lines.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
      : lines,
  );
  return embed;
}

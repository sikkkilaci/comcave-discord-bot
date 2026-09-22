import type { TextChannel } from 'discord.js';
import type { CourseContentItem } from '@prisma/client';
import { listCourseEntriesByClassId } from '../repositories/coursePlanRepository.js';
import { getCourseContentByCourseNumber } from './courseContentService.js';
import {
  buildClassCoursePlanEmbed,
  buildClassCoursePlanFooterText,
} from '../bot/ui/classCoursePlanMessage.js';

/**
 * Inhaltstexte, die (nach Entfernen der fuehrenden Nummerierung, siehe
 * CourseContentItem.text) mit "Klausur" beginnen, gelten als Pruefungs-
 * Marker - verifiziert gegen den realen Kursinhalte-Datensatz.
 */
const EXAM_MARKER_PATTERN = /^klausur\b/i;

function hasExamContent(items: readonly Pick<CourseContentItem, 'text'>[]): boolean {
  return items.some((item) => EXAM_MARKER_PATTERN.test(item.text.trim()));
}

export interface ClassCoursePlanSyncResult {
  total: number;
  posted: number;
  updated: number;
}

/**
 * Synchronisiert den automatisch gepflegten #-kursplan-Kanal einer Klasse
 * (siehe classAreaService.ts, Class.coursePlanChannelId): postet fuer jeden
 * chronologisch sortierten Kurs-Slot (CourseEntry) der Klasse eine eigene
 * Nachricht mit Titel, Zeitraum, Dozent und Kursgliederung (verknuepft ueber
 * `courseNumber`, siehe courseContentService.ts). Wird typischerweise direkt
 * nach einem `/kursplan-importieren`-Lauf aufgerufen (siehe
 * kursplanImportieren.ts).
 *
 * Idempotent per Nachrichten-Footer: eine bereits gepostete Nachricht zu
 * einem CourseEntry wird ueber die dort eingebettete CourseEntry-ID
 * wiedergefunden (buildClassCoursePlanFooterText()) und aktualisiert statt
 * dupliziert. Neue Kurs-Slots werden als neue Nachricht ans Kanalende
 * angehaengt. Discord liefert je Abruf maximal 100 Nachrichten - bei mehr
 * als 100 bereits geposteten Kurs-Slots in einem einzelnen Kanal wuerden
 * die aeltesten davon nicht mehr wiedergefunden und stattdessen erneut
 * gepostet; angesichts eines realistischen Kursplans (siehe /kursinhalte,
 * aktuell 34 Kurse insgesamt) ist das keine praktisch relevante Grenze.
 */
export async function syncClassCoursePlanChannel(
  channel: TextChannel,
  classId: string,
): Promise<ClassCoursePlanSyncResult> {
  const entries = await listCourseEntriesByClassId(classId);
  const existingMessages = await channel.messages.fetch({ limit: 100 });

  const result: ClassCoursePlanSyncResult = { total: entries.length, posted: 0, updated: 0 };

  for (const entry of entries) {
    const contentItems = await getCourseContentByCourseNumber(entry.courseNumber);
    const embed = buildClassCoursePlanEmbed(entry, hasExamContent(contentItems), contentItems);

    const marker = buildClassCoursePlanFooterText(entry);
    const existing = existingMessages.find((message) => message.embeds[0]?.footer?.text === marker);

    if (existing) {
      await existing.edit({ embeds: [embed] });
      result.updated += 1;
    } else {
      await channel.send({ embeds: [embed] });
      result.posted += 1;
    }
  }

  return result;
}

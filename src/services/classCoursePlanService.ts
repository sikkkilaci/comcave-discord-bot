import { ChannelType, type Guild, type GuildMember, type TextChannel } from 'discord.js';
import type { CourseContentItem, GuildConfig } from '@prisma/client';
import { getClassByName } from '../repositories/classRepository.js';
import { listCourseEntriesByClassId } from '../repositories/coursePlanRepository.js';
import { getCourseContentByCourseNumber } from './courseContentService.js';
import {
  importCoursePlanForClass,
  type CoursePlanImportResult,
} from './coursePlanImportService.js';
import {
  buildClassCoursePlanEmbed,
  buildClassCoursePlanFooterText,
} from '../bot/ui/classCoursePlanMessage.js';
import type { ClassName } from '../types/domain.js';

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

export interface KursplanImportAndSyncResult {
  importResult: CoursePlanImportResult;
  channelSummary: string;
}

/**
 * Buendelt genau die zwei Schritte, die `/kursplan-importieren` ausfuehrt
 * (Import + Kanal-Sync) - als eigene Funktion extrahiert, damit sowohl der
 * Slash-Befehl (kursplanImportieren.ts) als auch der gleichwertige Button im
 * Admin-Panel (siehe adminPanelService.ts/interactionCreate.ts) exakt
 * dieselbe Logik verwenden, statt sie an zwei Stellen zu pflegen.
 */
export async function runKursplanImportAndSync(
  guild: Guild,
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  actorDiscordId: string,
): Promise<KursplanImportAndSyncResult> {
  const importResult = await importCoursePlanForClass(
    guildConfig,
    member,
    className,
    actorDiscordId,
  );

  let channelSummary =
    'Kein Kursplan-Kanal vorhanden - bitte zuerst `/setup-klassenbereiche` erneut ausführen.';
  const klasse = await getClassByName(guild.id, className);
  if (klasse?.coursePlanChannelId) {
    const channel = await guild.channels.fetch(klasse.coursePlanChannelId);
    if (channel?.type === ChannelType.GuildText) {
      const syncResult = await syncClassCoursePlanChannel(channel, klasse.id);
      channelSummary =
        `Kanal #📚-kursplan aktualisiert: ${syncResult.posted} neu gepostet, ` +
        `${syncResult.updated} aktualisiert (${syncResult.total} Kurse insgesamt).`;
    }
  }

  return { importResult, channelSummary };
}

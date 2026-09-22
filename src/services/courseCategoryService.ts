import {
  ChannelType,
  DiscordAPIError,
  type CategoryChannel,
  type Guild,
  type Message,
  type TextChannel,
} from 'discord.js';
import type { CourseContentItem, GuildConfig } from '@prisma/client';
import { loadCourseSchedule } from './courseContentImportService.js';
import { getCourseContentByCourseNumber } from './courseContentService.js';
import { buildOverwrites } from './globalServerStructureService.js';
import { buildCourseCategoryEmbed } from '../bot/ui/courseCategoryMessage.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { ValidationError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('courseCategoryService');

/** Discord-API-Fehlercode fuer "Missing Permissions", siehe pinWithRetry(). */
const DISCORD_MISSING_PERMISSIONS = 50013;
/** Wartezeit vor dem einmaligen Pin-Retry, siehe pinWithRetry(). */
const PIN_RETRY_DELAY_MS = 1500;

/** Discord erlaubt Kategorie-/Kanalnamen von maximal 100 Zeichen. */
const MAX_CATEGORY_NAME_LENGTH = 100;

const CATEGORY_ICON_NORMAL = '📘';
const CATEGORY_ICON_EXAM = '⚠️';
const CONTENT_CHANNEL_NAME = '📄-kursinhalte';

/**
 * Inhaltstexte, die (nach Entfernen der fuehrenden Nummerierung, siehe
 * CourseContentItem.text) mit "Klausur" beginnen, gelten als Pruefungs-
 * Marker - verifiziert gegen den realen 34-Kurse-Datensatz (genau 10 Treffer,
 * deckungsgleich mit der vom Nutzer bereitgestellten "Klausur im Modul"-Liste).
 */
const EXAM_MARKER_PATTERN = /^klausur\b/i;

function hasExamContent(items: readonly Pick<CourseContentItem, 'text'>[]): boolean {
  return items.some((item) => EXAM_MARKER_PATTERN.test(item.text.trim()));
}

export interface CourseCatalogEntry {
  courseNumber: string;
  courseTitle: string;
  start: Date;
  end: Date;
  hasExam: boolean;
  contentItems: CourseContentItem[];
}

/**
 * Baut den vollstaendigen Kurs-Katalog: Kursnummer/-titel/-zeitraum werden
 * frisch aus der versionierten Kursinhalte-Quelldatei gelesen (siehe
 * loadCourseSchedule() - bewusst NICHT aus der DB, da Start-/Enddatum dort
 * laut data/course-plans/README.md nicht gespeichert werden), die
 * Kursgliederung je Kurs kommt aus dem bereits importierten
 * CourseContentItem-Bestand (getCourseContentByCourseNumber()). Ein Kurs ohne
 * importierte Inhalte liefert ein leeres contentItems-Array statt eines
 * Fehlers (siehe courseContentService.ts) und wird trotzdem mit Titel/
 * Zeitraum in den Katalog aufgenommen. Ergebnis chronologisch nach Startdatum
 * sortiert.
 */
export async function getCourseCatalog(): Promise<CourseCatalogEntry[]> {
  const schedule = await loadCourseSchedule();

  const entries = await Promise.all(
    schedule.map(async (course): Promise<CourseCatalogEntry> => {
      const contentItems = await getCourseContentByCourseNumber(course.courseNumber);
      return {
        courseNumber: course.courseNumber,
        courseTitle: course.courseTitle,
        start: course.start,
        end: course.end,
        hasExam: hasExamContent(contentItems),
        contentItems,
      };
    }),
  );

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function buildCategoryName(entry: CourseCatalogEntry): string {
  const icon = entry.hasExam ? CATEGORY_ICON_EXAM : CATEGORY_ICON_NORMAL;
  const base = `${icon} ${entry.courseNumber} · ${entry.courseTitle}`;
  return base.length > MAX_CATEGORY_NAME_LENGTH
    ? `${base.slice(0, MAX_CATEGORY_NAME_LENGTH - 1)}…`
    : base;
}

/**
 * Findet die Kategorie eines Kurses ueber den in buildCategoryName() fest
 * eingebetteten " <Kursnummer> · "-Abschnitt - bewusst kein DB-Tracking (wie
 * bei globalServerStructureService.ts), da Kursnummern innerhalb des
 * Katalogs eindeutig sind und dieser Namensabgleich zugleich selbstheilend
 * ist: aendert sich Titel oder Klausur-Kennzeichnung eines Kurses zwischen
 * zwei Laeufen, wird dieselbe Kategorie wiedergefunden und umbenannt (siehe
 * ensureCourseCategory()), statt eine zweite anzulegen.
 */
async function findCategoryByCourseNumber(
  guild: Guild,
  courseNumber: string,
): Promise<CategoryChannel | undefined> {
  const token = ` ${courseNumber} · `;
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (channel?.type === ChannelType.GuildCategory && channel.name.includes(token)) {
      return channel;
    }
  }
  return undefined;
}

interface BaseRoles {
  onboardedRoleId: string;
  adminRoleId: string;
  moderatorRoleId: string;
}

function requireBaseRoles(guildConfig: GuildConfig): BaseRoles {
  const { onboardedRoleId, adminRoleId, moderatorRoleId } = guildConfig;
  if (!onboardedRoleId || !adminRoleId || !moderatorRoleId) {
    throw new ValidationError(
      'Die Grundrollen muessen vor der Kurs-Kategorien-Einrichtung konfiguriert sein (siehe /setup-server).',
    );
  }
  return { onboardedRoleId, adminRoleId, moderatorRoleId };
}

/**
 * Wie die Kanaele der globalen Serverstruktur (siehe globalServerStructureService.ts) sind
 * Kurs-Kategorien fuer alle vollstaendig onboardeten Mitglieder ('VERIFIED'/onboardedRoleId,
 * trotz des irrefuehrenden Namens - siehe dortiger Kommentar) sichtbar, nicht auf eine
 * einzelne Klasse beschraenkt, und read-only (nur der Bot postet).
 */
async function ensureCourseCategory(
  guild: Guild,
  roles: BaseRoles,
  botRoleId: string,
  entry: CourseCatalogEntry,
): Promise<{ category: CategoryChannel; created: boolean; renamed: boolean }> {
  const reason = `Kurs-Kategorie fuer Kurs ${entry.courseNumber}`;
  const desiredName = buildCategoryName(entry);
  const overwrites = buildOverwrites(
    guild,
    'VERIFIED',
    roles.onboardedRoleId,
    roles.adminRoleId,
    roles.moderatorRoleId,
    botRoleId,
    true,
  );

  const existing = await findCategoryByCourseNumber(guild, entry.courseNumber);
  if (existing) {
    await existing.permissionOverwrites.set(overwrites, reason);
    if (existing.name !== desiredName) {
      await existing.setName(desiredName, reason);
      return { category: existing, created: false, renamed: true };
    }
    return { category: existing, created: false, renamed: false };
  }

  const category = await guild.channels.create({
    name: desiredName,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason,
  });

  return { category, created: true, renamed: false };
}

async function ensureCourseChannel(
  guild: Guild,
  roles: BaseRoles,
  botRoleId: string,
  category: CategoryChannel,
  entry: CourseCatalogEntry,
): Promise<{ channel: TextChannel; created: boolean }> {
  const reason = `Kursinhalte-Kanal fuer Kurs ${entry.courseNumber}`;
  const overwrites = buildOverwrites(
    guild,
    'VERIFIED',
    roles.onboardedRoleId,
    roles.adminRoleId,
    roles.moderatorRoleId,
    botRoleId,
    true,
  );

  const existing = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.parentId === category.id &&
      channel.name === CONTENT_CHANNEL_NAME &&
      channel.type === ChannelType.GuildText,
  );

  if (existing) {
    await existing.permissionOverwrites.set(overwrites, reason);
    return { channel: existing, created: false };
  }

  const channel = await guild.channels.create({
    name: CONTENT_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
    topic: `Kursinhalte: ${entry.courseTitle} (${entry.courseNumber})`,
    reason,
  });

  return { channel, created: true };
}

/**
 * Legt/aktualisiert die einzige Nachricht eines Kursinhalte-Kanals: existiert
 * bereits eine vom Bot gepostete (angepinnte) Nachricht, wird sie per edit()
 * aktualisiert statt eine weitere zu posten - macht jeden erneuten
 * `/setup-kurskategorien`-Lauf zu einem echten Refresh (z. B. nach einem
 * geaenderten Kursinhalte-Import), nicht nur eine einmalige Kosmetik wie die
 * Willkommensnachrichten in classAreaService.ts.
 */
async function upsertContentMessage(
  channel: TextChannel,
  entry: CourseCatalogEntry,
): Promise<boolean> {
  const embed = buildCourseCategoryEmbed(entry);
  const botUserId = channel.client.user?.id;
  const pinned = await channel.messages.fetchPinned();
  const existing = botUserId ? pinned.find((message) => message.author.id === botUserId) : null;

  if (existing) {
    await existing.edit({ embeds: [embed] });
    return false;
  }

  const message = await channel.send({ embeds: [embed] });
  await pinWithRetry(message);
  return true;
}

/**
 * Siehe pinWithRetry() in classAreaService.ts fuer die Herleitung: Discord
 * lehnt ein Anpinnen unmittelbar nach dem Anlegen eines Kanals reproduzierbar
 * mit 403/50013 ab, obwohl der Bot ManageMessages besitzt (Eventual-
 * Consistency-Verhalten). Ein einmaliger, kurzer Retry behebt das.
 */
async function pinWithRetry(message: Message): Promise<void> {
  try {
    await message.pin();
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      await sleep(PIN_RETRY_DELAY_MS);
      await message.pin();
      return;
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CourseCategorySetupResult {
  totalCourses: number;
  coursesWithExam: number;
  categoriesCreated: number;
  categoriesRenamed: number;
  categoriesReused: number;
  channelsCreated: number;
  contentPosted: number;
  contentUpdated: number;
}

/**
 * Richtet eine Discord-Kategorie je Kurs des Kurs-Katalogs ein (siehe
 * getCourseCatalog()) - fest 34 Kategorien (Stand der aktuell importierten
 * Kursinhalte-Quelle), bewusst NICHT eine je Kalenderwoche (waere ueber eine
 * mehrjaehrige Ausbildung hinweg nicht durch Discords Limit von ~50
 * Kategorien pro Server gedeckt). Jede Kategorie enthaelt genau einen Kanal
 * (CONTENT_CHANNEL_NAME) mit Titel, Zeitraum, Klausur-Hinweis (falls erkannt)
 * und vollstaendiger Kursgliederung. Vollstaendig idempotent: ein erneuter
 * Aufruf legt nichts doppelt an, aktualisiert aber Berechtigungen, Namen
 * (z. B. bei neu erkannter Klausur) und den Inhalt der geposteten Nachricht.
 */
export async function setupCourseCategories(
  guild: Guild,
  guildConfig: GuildConfig,
  actorDiscordId: string,
): Promise<CourseCategorySetupResult> {
  const roles = requireBaseRoles(guildConfig);

  const botMember = guild.members.me;
  const botRoleId = botMember?.roles.highest.id;
  if (!botRoleId) {
    throw new ValidationError(
      'Die Bot-Rolle konnte fuer die Kurs-Kategorien-Einrichtung nicht ermittelt werden.',
    );
  }

  const catalog = await getCourseCatalog();

  const result: CourseCategorySetupResult = {
    totalCourses: catalog.length,
    coursesWithExam: catalog.filter((entry) => entry.hasExam).length,
    categoriesCreated: 0,
    categoriesRenamed: 0,
    categoriesReused: 0,
    channelsCreated: 0,
    contentPosted: 0,
    contentUpdated: 0,
  };

  for (const entry of catalog) {
    const { category, created, renamed } = await ensureCourseCategory(
      guild,
      roles,
      botRoleId,
      entry,
    );
    if (created) result.categoriesCreated += 1;
    else if (renamed) result.categoriesRenamed += 1;
    else result.categoriesReused += 1;

    const { channel, created: channelCreated } = await ensureCourseChannel(
      guild,
      roles,
      botRoleId,
      category,
      entry,
    );
    if (channelCreated) result.channelsCreated += 1;

    const posted = await upsertContentMessage(channel, entry);
    if (posted) result.contentPosted += 1;
    else result.contentUpdated += 1;
  }

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'courseCategories.setup',
    metadata: { ...result },
  });

  logger.info({ guildId: guildConfig.id, ...result }, 'Kurs-Kategorien eingerichtet');

  return result;
}

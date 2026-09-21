import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type OverwriteResolvable,
  type ReadonlyCollection,
  type TextChannel,
} from 'discord.js';
import type { Class, GuildConfig } from '@prisma/client';
import { updateClassChannels, type ClassChannelUpdate } from '../repositories/classRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('classAreaService');

/** Discord-API-Fehlercode fuer "Missing Permissions". */
const DISCORD_MISSING_PERMISSIONS = 50013;
/** Discord-API-Fehlercode fuer "Missing Access" (siehe ensureBotAccess()-Kommentar). */
const DISCORD_MISSING_ACCESS = 50001;

type ChannelKey = Exclude<keyof ClassChannelUpdate, 'categoryId'>;

interface ChannelBlueprint {
  key: ChannelKey;
  name: string;
  type: ChannelType.GuildText | ChannelType.GuildVoice;
  /** Klassenrolle darf hier nur lesen (z. B. Ankuendigungen), nicht schreiben. */
  readOnlyForClass?: boolean;
  /** Discords natives Kanal-"Thema" - erklaert den Zweck direkt im Kanal-Header. */
  topic?: string;
  /**
   * Einmalige, angepinnte Nachricht direkt nach dem Neuanlegen (nicht bei
   * Wiederverwendung eines bereits vorhandenen Kanals - siehe setupClassArea()).
   * Rein kosmetisch/informativ, kein Ersatz fuer echte Fachlogik.
   */
  welcomeMessage?: string;
}

/**
 * Die sieben Kanaele eines privaten Klassenbereichs. Bewusst als feste,
 * deklarative Liste statt konfigurierbar - deckt die in der Anforderung
 * genannten Bereiche ab (Klassenchat, Ankuendigungen, Termine, Pruefungen,
 * Berichtsheft/Tagesberichte, Lernmaterial, Sprachkanal). Nur "Ankuendigungen"
 * ist eindeutig als Einweg-Kanal zu verstehen (read-only fuer die Klasse);
 * alle anderen bleiben voll beschreibbar, da z. B. das Berichtsheft von den
 * Mitgliedern selbst befuellt wird. Admins koennen einzelne Kanal-Berechtigungen
 * bei Bedarf manuell in Discord weiter anpassen. Emoji-Praefix, Thema und
 * Willkommensnachricht sind rein kosmetisch (lesbarer/einladender direkt nach
 * /setup-server bzw. /setup-klassenbereiche) und aendern nichts an Rechten
 * oder Datenmodell.
 */
const CHANNEL_BLUEPRINTS: readonly ChannelBlueprint[] = [
  {
    key: 'chatChannelId',
    name: '💬-klassenchat',
    type: ChannelType.GuildText,
    topic: 'Offener Chat der Klasse.',
    welcomeMessage:
      '👋 Willkommen im Klassenchat! Hier ist Platz für alles, was nicht in einen der anderen ' +
      'Kanäle gehört.',
  },
  {
    key: 'announcementChannelId',
    name: '📢-ankuendigungen',
    type: ChannelType.GuildText,
    readOnlyForClass: true,
    topic: 'Ankündigungen der Klassenleitung/Admins - nur Lesezugriff für die Klasse.',
    welcomeMessage:
      '📢 Hier postet die Klassenleitung wichtige Ankündigungen. Ihr könnt hier nur lesen, ' +
      'nicht schreiben.',
  },
  {
    key: 'scheduleChannelId',
    name: '📅-termine',
    type: ChannelType.GuildText,
    topic: 'Anstehende Termine der Klasse.',
    welcomeMessage:
      '📅 Hier findet ihr anstehende Termine eurer Klasse. `/kursplan` zeigt euren aktuellen ' +
      'Kursplan mit Kalenderwoche, `/kursinhalte` die Kursgliederung.',
  },
  {
    key: 'examChannelId',
    name: '🎓-pruefungen',
    type: ChannelType.GuildText,
    topic: 'Prüfungen der Klasse.',
    welcomeMessage:
      '🎓 Hier werden Prüfungen angekündigt. `/pruefungen-anzeigen` zeigt eine Übersicht.',
  },
  {
    key: 'reportChannelId',
    name: '📝-berichtsheft',
    type: ChannelType.GuildText,
    topic: 'Tages-/Wochenberichte fürs Berichtsheft.',
    welcomeMessage:
      '📝 Hier dokumentiert ihr eure Tages- und Wochenberichte. Nutzt `/tagesbericht-erstellen` ' +
      'bzw. `/wochenbericht-erstellen`.',
  },
  {
    key: 'materialChannelId',
    name: '📚-lernmaterial',
    type: ChannelType.GuildText,
    topic: 'Geteiltes Lernmaterial der Klasse.',
    welcomeMessage:
      '📚 Hier teilt die Klassenleitung Lernmaterial. `/lernmaterial-anzeigen` zeigt eine ' +
      'Übersicht.',
  },
  { key: 'voiceChannelId', name: '🔊-sprachkanal', type: ChannelType.GuildVoice },
];

/**
 * Rechte der Klassenleitungs-Rolle - ausschliesslich als Kanal-/Kategorie-
 * Overwrite vergeben, NIE als Basis-Rollenberechtigung (siehe classLeadService.ts,
 * wo die Rolle immer mit `permissions: []` angelegt wird). Dadurch wirken diese
 * Rechte technisch nur innerhalb der eigenen Klassenkanaele, nicht serverweit.
 *
 * Deckt die geforderten Aktionen ab: Nachrichten senden/loeschen/anheften
 * (ManageMessages), Dateien/PDFs hochladen (AttachFiles/EmbedLinks), Threads
 * erstellen und verwalten, die eigene Klassenrolle erwaehnen (MentionEveryone -
 * hier ungefaehrlich, da nur in den eigenen Klassenkanaelen wirksam) sowie den
 * Klassen-Sprachkanal moderieren (Mute/Deafen/Move) und bei Bedarf einzelne
 * Mitglieder des eigenen Klassenbereichs per Timeout moderieren (ModerateMembers -
 * wirkt sich nur auf Mitglieder aus, die ueberhaupt in diesen privaten Kanaelen
 * sichtbar sind, also ausschliesslich die eigene Klasse).
 *
 * In TEXT_PERMISSIONS und VOICE_ONLY_PERMISSIONS aufgeteilt, da Discord das
 * Anlegen eines Textkanals ablehnt (403/50013 "Missing Permissions"), sobald
 * dessen Overwrites reine Sprachkanal-Bits (Connect/Speak/Mute/Deafen/Move)
 * enthalten - unabhaengig davon, ob der Bot diese Bits selbst besitzt. Diese
 * Bits duerfen daher nur in den Overwrites des tatsaechlichen Sprachkanals
 * (voiceChannelId) landen, nicht in denen der Textkanaele.
 *
 * Bewusst AUSGESCHLOSSEN (niemals Teil dieser Listen oder einer Basis-Rollen-
 * berechtigung): Administrator, ManageGuild, ManageRoles, ManageChannels,
 * ManageWebhooks, KickMembers, BanMembers und jede andere serverweite Rechte-
 * Aenderung. "Termine/Events verwalten" wird bewusst NICHT ueber Discords
 * natives Server-Event-System (ManageEvents) abgebildet, da dieses Recht sich
 * in Discord nicht auf eine einzelne Klasse beschraenken laesst - stattdessen
 * bekommt die Klassenleitung volle Nachrichtenkontrolle im dedizierten
 * Termine-Kanal (siehe scheduleChannelId), was das eigentliche Bedürfnis
 * abdeckt, ohne serverweite Rechte zu vergeben (Fail-closed-Entscheidung).
 */
const CLASS_LEAD_TEXT_PERMISSIONS: bigint[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers,
];

const CLASS_LEAD_VOICE_ONLY_PERMISSIONS: bigint[] = [
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
];

/**
 * Eigener Overwrite-Eintrag des Bots auf Kategorie/Kanal (siehe buildOverwrites()-Kommentar
 * dazu) UND als "Reparatur-Set" fuer bereits bestehende, wiederverwendete Kategorien/Kanaele
 * (siehe ensureBotAccess()) - dieselben Bits an beiden Stellen, damit ein wiederverwendeter
 * Bereich exakt denselben Zugriff bekommt wie ein neu angelegter.
 */
const BOT_CHANNEL_PERMISSIONS: readonly bigint[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

export interface ClassAreaSetupResult {
  className: string;
  categoryCreated: boolean;
  /** Namen der in diesem Aufruf neu angelegten Kanaele. */
  channelsCreated: string[];
  /** Namen der bereits vorhandenen (uebersprungenen) Kanaele. */
  channelsSkipped: string[];
}

/**
 * Richtet den privaten Bereich einer Klasse ein: eine Kategorie plus sieben
 * Kanaele, sichtbar nur fuer die Klassenrolle (und optional die konfigurierte
 * Admin-/Klassenleitungs-Rolle). Sowohl die Kategorie als auch jeder einzelne
 * Kanal werden unabhaengig voneinander auf Idempotenz geprueft (per
 * `guild.channels.fetch`) - ein erneuter Aufruf legt nichts doppelt an und
 * repariert fehlende/geloeschte Kanaele einzeln nach, ohne die bereits
 * vorhandenen anzufassen.
 *
 * Wirft ValidationError, wenn die Klasse noch keine Rolle hat (siehe
 * /setup-klassen) oder wenn dem Bot die Berechtigung zum Anlegen von Kanaelen
 * fehlt.
 */
export async function setupClassArea(
  guild: Guild,
  guildConfig: GuildConfig,
  klasse: Class,
  actorDiscordId: string,
): Promise<ClassAreaSetupResult> {
  if (!klasse.roleId) {
    throw new ValidationError(
      `Klasse ${klasse.name} hat noch keine Rolle. Bitte zuerst /setup-klassen ausfuehren.`,
    );
  }

  const botRoleId = await resolveBotRoleId(guild);

  const category = await ensureCategory(guild, guildConfig, klasse, botRoleId);
  // Sofort persistieren, NICHT erst am Ende der Funktion sammeln: schlaegt ein spaeterer
  // Kanal in derselben Ausfuehrung fehl, wuerde ein erneuter /setup-server-Aufruf sonst
  // klasse.categoryId weiterhin als null vorfinden und eine weitere Kategorie duplizieren
  // (Wurzelursache eines echten Vorfalls: mehrere "Klasse A"-Kategorien nach fehlgeschlagenen
  // Wiederholungen). Jeder erfolgreich angelegte/wiederverwendete Baustein wird daher einzeln
  // und sofort gespeichert, statt gesammelt am Ende.
  // Nicht nur bei Neuanlage persistieren, sondern auch, wenn ensureCategory() die Kategorie
  // per Namensabgleich wiedergefunden hat (klasse.categoryId war zuvor null/veraltet) - sonst
  // bliebe die DB dauerhaft auf dem "vergessenen" Stand, obwohl die tatsaechliche ID jetzt
  // bekannt ist.
  if (category.id !== klasse.categoryId) {
    await updateClassChannels(guildConfig.id, klasse.name as ClassName, {
      categoryId: category.id,
    });
  }

  const channelsCreated: string[] = [];
  const channelsSkipped: string[] = [];

  for (const blueprint of CHANNEL_BLUEPRINTS) {
    const channelReason = `Privater Klassenbereich fuer Klasse ${klasse.name}`;
    const existingId = klasse[blueprint.key];
    const existing = existingId ? await fetchChannelSafely(guild, existingId) : null;

    if (existing) {
      await ensureBotAccess(existing, botRoleId, channelReason);
      channelsSkipped.push(blueprint.name);
      continue;
    }

    const byName = await findChannelByName(guild, blueprint.name, category.id, blueprint.type);
    if (byName) {
      await ensureBotAccess(byName, botRoleId, channelReason);
      await updateClassChannels(
        guildConfig.id,
        klasse.name as ClassName,
        {
          [blueprint.key]: byName.id,
        } as ClassChannelUpdate,
      );
      channelsSkipped.push(blueprint.name);
      continue;
    }

    const overwrites = buildOverwrites(guild, guildConfig, klasse, {
      classCanSend: !blueprint.readOnlyForClass,
      includeVoicePermissions: blueprint.type === ChannelType.GuildVoice,
      botRoleId,
    });

    const channel = await createChannelOrThrow(guild, {
      name: blueprint.name,
      type: blueprint.type,
      parent: category.id,
      permissionOverwrites: overwrites,
      ...(blueprint.topic ? { topic: blueprint.topic } : {}),
      reason: `Privater Klassenbereich fuer Klasse ${klasse.name}`,
    });

    // Auch hier sofort statt gesammelt persistieren, aus demselben Grund wie bei der Kategorie.
    await updateClassChannels(
      guildConfig.id,
      klasse.name as ClassName,
      {
        [blueprint.key]: channel.id,
      } as ClassChannelUpdate,
    );
    channelsCreated.push(blueprint.name);

    if (blueprint.welcomeMessage && blueprint.type === ChannelType.GuildText) {
      await postWelcomeMessage(channel, blueprint.welcomeMessage);
    }
  }

  if (category.created || channelsCreated.length > 0) {
    await logAuditEvent({
      guildId: guildConfig.id,
      actorDiscordId,
      action: 'class.area_setup',
      metadata: { className: klasse.name, categoryCreated: category.created, channelsCreated },
    });
  }

  logger.info(
    {
      guildId: guildConfig.id,
      className: klasse.name,
      categoryCreated: category.created,
      channelsCreated,
      channelsSkipped,
    },
    'Klassenbereich eingerichtet',
  );

  return {
    className: klasse.name,
    categoryCreated: category.created,
    channelsCreated,
    channelsSkipped,
  };
}

const CATEGORY_NAME_PREFIX = '📁 Klasse ';

function categoryName(klasse: Class): string {
  return `${CATEGORY_NAME_PREFIX}${klasse.name}`;
}

async function ensureCategory(
  guild: Guild,
  guildConfig: GuildConfig,
  klasse: Class,
  botRoleId: string | undefined,
): Promise<{ id: string; created: boolean }> {
  const reason = `Privater Klassenbereich fuer Klasse ${klasse.name}`;

  if (klasse.categoryId) {
    const existing = await fetchChannelSafely(guild, klasse.categoryId);
    if (existing) {
      // Eine wiederverwendete Kategorie kann von VOR dem Bot-Overwrite-Fix stammen und dem
      // Bot dadurch dauerhaft den Zugriff verweigern (siehe ensureBotAccess()-Kommentar) -
      // ohne diese Reparatur wuerde jeder Kanal darunter mit 403/50013 fehlschlagen, egal wie
      // unauffaellig dessen eigener Overwrite-Payload ist.
      await ensureBotAccess(existing, botRoleId, reason);
      return { id: existing.id, created: false };
    }
  }

  // Stabiler Namensabgleich als zweite Idempotenz-Ebene: klasse.categoryId ist nur gesetzt,
  // wenn ein vorheriger Lauf VOLLSTAENDIG durchlief. Ein Lauf, der z. B. beim Anlegen eines
  // Kanals fehlschlug, hat die zuvor bereits neu angelegte Kategorie evtl. nie in der DB
  // gespeichert - ohne diesen Namensabgleich wuerde ein erneuter Aufruf sie dann ein zweites
  // Mal anlegen (realer Vorfall: mehrere "📁 Klasse A"-Kategorien nach fehlgeschlagenen
  // Wiederholungen).
  const existingByName = await findCategoryByName(guild, categoryName(klasse));
  if (existingByName) {
    await ensureBotAccess(existingByName, botRoleId, reason);
    return { id: existingByName.id, created: false };
  }

  // Kategorie-Overwrites duerfen (im Unterschied zu Text-Kanaelen) Sprachkanal-Bits enthalten -
  // eine Kategorie hat keinen eigenen Kanaltyp, Discord validiert Overwrite-Bits nur gegen den
  // tatsaechlichen Kanaltyp bei Text-/Sprachkanaelen selbst (siehe buildOverwrites()-Kommentar).
  const overwrites = buildOverwrites(guild, guildConfig, klasse, {
    classCanSend: true,
    includeVoicePermissions: true,
    botRoleId,
  });
  const category = await createChannelOrThrow(guild, {
    name: categoryName(klasse),
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason,
  });

  return { id: category.id, created: true };
}

/**
 * Baut die Permission-Overwrites fuer Kategorie/Kanal: @everyone ausgeschlossen,
 * Klassenrolle sichtbar (mit oder ohne Schreibrecht), optional die
 * Admin-Rolle und - falls bereits konfiguriert - die Klassenleitungs-Rolle
 * (`Class.leadRoleId`). Klassenleitung ist aktuell noch nicht ueber ein
 * eigenes Setup-Command vergebbar, aber sobald `leadRoleId` gesetzt wird,
 * greift diese Berechtigung ohne weitere Codeaenderung - Vorbereitung fuer
 * "Klassenleitung darf nur die eigene Klasse verwalten".
 */
function buildOverwrites(
  guild: Guild,
  guildConfig: GuildConfig,
  klasse: Class,
  options: {
    classCanSend: boolean;
    includeVoicePermissions: boolean;
    botRoleId: string | undefined;
  },
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  // Ohne diesen eigenen Overwrite-Eintrag wuerde das @everyone-Deny oben den Bot (der - anders
  // als Administrator-Rollen - keine der weiter unten vergebenen Rollen-Allows automatisch
  // erbt) von der soeben erzeugten Kategorie/dem Kanal aussperren: jede folgende Aktion (z. B.
  // einen Kanal unter der Kategorie anzulegen oder eine Willkommensnachricht zu posten und
  // anzupinnen) schlaegt dann mit 403/50013 "Missing Permissions" fehl, obwohl der Bot alle
  // dafuer noetigen Basis-Berechtigungen besitzt (echter, per Overwrite-Payload verifizierter
  // Vorfall). ManageMessages ist fuer das Anpinnen der Willkommensnachricht noetig.
  if (options.botRoleId) {
    overwrites.push({ id: options.botRoleId, allow: [...BOT_CHANNEL_PERMISSIONS] });
  }

  if (klasse.roleId) {
    const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
    if (options.includeVoicePermissions) {
      allow.push(PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
    }
    if (options.classCanSend) {
      allow.push(
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      );
    }
    overwrites.push({
      id: klasse.roleId,
      allow,
      ...(options.classCanSend ? {} : { deny: [PermissionFlagsBits.SendMessages] }),
    });
  }

  if (guildConfig.adminRoleId) {
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (options.includeVoicePermissions) {
      allow.push(PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
    }
    overwrites.push({ id: guildConfig.adminRoleId, allow });
  }

  if (guildConfig.moderatorRoleId) {
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (options.includeVoicePermissions) {
      allow.push(
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers,
      );
    }
    overwrites.push({ id: guildConfig.moderatorRoleId, allow });
  }

  if (klasse.leadRoleId) {
    overwrites.push({
      id: klasse.leadRoleId,
      allow: options.includeVoicePermissions
        ? [...CLASS_LEAD_TEXT_PERMISSIONS, ...CLASS_LEAD_VOICE_ONLY_PERMISSIONS]
        : CLASS_LEAD_TEXT_PERMISSIONS,
    });
  }

  return overwrites;
}

async function fetchChannelSafely(
  guild: Guild,
  channelId: string,
): Promise<GuildBasedChannel | null> {
  try {
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

/** Zweite Idempotenz-Ebene fuer die Klassen-Kategorie, siehe ensureCategory(). */
async function findCategoryByName(guild: Guild, name: string): Promise<GuildBasedChannel | null> {
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (channel && channel.type === ChannelType.GuildCategory && channel.name === name) {
      return channel;
    }
  }
  return null;
}

/**
 * Zweite Idempotenz-Ebene fuer die sieben Klassenkanaele: greift, wenn ein vorheriger Lauf
 * einen Kanal bereits anlegte, dessen ID aber (z. B. durch einen danach fehlgeschlagenen
 * weiteren Kanal) nie in der DB gespeichert wurde. Namensabgleich ist hier eindeutig genug,
 * da alle sieben Kanalnamen innerhalb einer Klassen-Kategorie garantiert einzigartig sind.
 */
async function findChannelByName(
  guild: Guild,
  name: string,
  parentId: string,
  type: ChannelType.GuildText | ChannelType.GuildVoice,
): Promise<GuildBasedChannel | null> {
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (
      channel &&
      channel.type === type &&
      channel.name === name &&
      channel.parentId === parentId
    ) {
      return channel;
    }
  }
  return null;
}

/**
 * Selbstheilung fuer bereits bestehende (wiederverwendete) Kategorien/Kanaele: fasst NUR den
 * Bot-eigenen Overwrite-Eintrag an (per permissionOverwrites.create(), nicht .set()) - alle
 * anderen Overwrites (z. B. manuell in Discord angepasste Rollenrechte) bleiben unberuehrt.
 * Noetig, weil ein vor diesem Fix angelegter Bereich den Bot-Overwrite nie erhalten hat und
 * der Bot dadurch dauerhaft "blind" fuer ihn bliebe, selbst nachdem buildOverwrites() fuer NEU
 * angelegte Bereiche bereits korrigiert wurde (echter Vorfall: 403/50013 beim Anlegen eines
 * Kanals unter einer bereits bestehenden, wiederverwendeten Kategorie).
 */
async function ensureBotAccess(
  channel: GuildBasedChannel,
  botRoleId: string | undefined,
  reason: string,
): Promise<void> {
  if (!botRoleId) return;
  // Threads haben kein eigenes permissionOverwrites - kommen hier aber ohnehin nie vor (dieses
  // Modul legt/findet ausschliesslich Kategorien, Text- und Sprachkanaele).
  if (!('permissionOverwrites' in channel)) return;
  const existingOverwrite = channel.permissionOverwrites.cache.get(botRoleId);
  const hasFullAccess = BOT_CHANNEL_PERMISSIONS.every(
    (bit) => existingOverwrite?.allow.has(bit) ?? false,
  );
  if (hasFullAccess) return;

  const allowOptions = Object.fromEntries(
    new PermissionsBitField(BOT_CHANNEL_PERMISSIONS as bigint[])
      .toArray()
      .map((name) => [name, true]),
  );
  try {
    await channel.permissionOverwrites.create(botRoleId, allowOptions, { reason });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_ACCESS) {
      // Belegter Grenzfall von Discord selbst: ein Bot ohne jede Sicht auf einen Kanal kann
      // sich diese Sicht auch ueber das Bearbeiten der Kanal-Berechtigungen NICHT selbst
      // verschaffen (dieselbe PUT-.../permissions-Route verlangt exakt die Sicht, die hier
      // erst hergestellt werden soll - ein serverseitiger Deadlock, kein Bug in diesem Code).
      // Nur ein Mensch mit Server-Zugriff (Owner/Admin sehen JEDEN Kanal unabhaengig von
      // Overwrites) kann das aufloesen, z. B. durch Loeschen und Neuanlegen des Kanals.
      throw new ValidationError(
        `Ich habe keinerlei Zugriff auf den Kanal/die Kategorie "${channel.name}" (ID: ${channel.id}) ` +
          'und kann mir diesen Zugriff auch nicht selbst verschaffen - das lehnt Discord serverseitig ' +
          'ab, unabhaengig von meinen sonstigen Berechtigungen. Das passiert nur bei Kanaelen/' +
          'Kategorien aus einem sehr alten Lauf, bevor ich mir selbst einen Overwrite-Eintrag gegeben ' +
          'habe. Bitte lösche "' +
          channel.name +
          '" (ID ' +
          channel.id +
          ') einmal manuell in Discord (als Server-Owner/Admin siehst du ihn, ich nicht) und ' +
          'führe den Befehl danach erneut aus - er wird dann sauber neu angelegt.',
      );
    }
    throw error;
  }
}

/**
 * Effektive hoechste Rolle des Bots - wird als eigener Overwrite-Eintrag in buildOverwrites()
 * benoetigt (siehe dortiger Kommentar). `undefined` (statt eines Wurfs) im seltenen Fehlerfall,
 * damit ein voruebergehendes Auflösungsproblem nicht den gesamten Klassenbereichs-Aufbau
 * blockiert - ohne Bot-Overwrite bleibt das Modul funktional wie vor diesem Fix.
 */
async function resolveBotRoleId(guild: Guild): Promise<string | undefined> {
  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    return me.roles.highest.id;
  } catch {
    return undefined;
  }
}

/**
 * Menschenlesbare Namen fuer alle Berechtigungs-Bits, die in diesem Modul
 * jemals per Kanal-Overwrite an eine Rolle vergeben werden (siehe
 * buildOverwrites()/CLASS_LEAD_CHANNEL_PERMISSIONS) - wird nur fuer
 * Fehlermeldungen benoetigt, nicht fuer die eigentliche Pruefung.
 */
const PERMISSION_LABELS = new Map<bigint, string>([
  [PermissionFlagsBits.ManageChannels, 'Kanaele verwalten'],
  [PermissionFlagsBits.ViewChannel, 'Kanal ansehen'],
  [PermissionFlagsBits.SendMessages, 'Nachrichten senden'],
  [PermissionFlagsBits.ReadMessageHistory, 'Nachrichtenverlauf anzeigen'],
  [PermissionFlagsBits.Connect, 'Verbinden'],
  [PermissionFlagsBits.Speak, 'Sprechen'],
  [PermissionFlagsBits.AttachFiles, 'Dateien anhaengen'],
  [PermissionFlagsBits.EmbedLinks, 'Links einbetten'],
  [PermissionFlagsBits.ManageMessages, 'Nachrichten verwalten'],
  [PermissionFlagsBits.CreatePublicThreads, 'Oeffentliche Threads erstellen'],
  [PermissionFlagsBits.CreatePrivateThreads, 'Private Threads erstellen'],
  [PermissionFlagsBits.SendMessagesInThreads, 'Nachrichten in Threads senden'],
  [PermissionFlagsBits.ManageThreads, 'Threads verwalten'],
  [PermissionFlagsBits.MentionEveryone, '@everyone erwaehnen'],
  [PermissionFlagsBits.MuteMembers, 'Mitglieder stummschalten'],
  [PermissionFlagsBits.DeafenMembers, 'Mitglieder isolieren'],
  [PermissionFlagsBits.MoveMembers, 'Mitglieder verschieben'],
  [PermissionFlagsBits.ModerateMembers, 'Mitglieder timeouten'],
]);

function permissionLabel(bit: bigint): string {
  return PERMISSION_LABELS.get(bit) ?? bit.toString();
}

/**
 * Extrahiert alle Berechtigungs-Bits, die per `allow` in den hier
 * konstruierten Overwrites vergeben werden. Dieses Modul baut Overwrites
 * ausschliesslich selbst (buildOverwrites()) und immer als `bigint[]` - eine
 * andere Form (String-Permission-Namen, PermissionsBitField-Instanz) kommt
 * hier nie vor, wird defensiv aber einfach ignoriert statt einen Fehler zu
 * werfen.
 */
function collectAllowedBits(
  overwrites: readonly OverwriteResolvable[] | ReadonlyCollection<string, OverwriteResolvable>,
): bigint[] {
  const bits: bigint[] = [];
  for (const overwrite of overwrites.values()) {
    const allow = (overwrite as { allow?: unknown }).allow;
    if (Array.isArray(allow)) {
      for (const bit of allow) {
        if (typeof bit === 'bigint') bits.push(bit);
      }
    }
  }
  return bits;
}

/**
 * Discord erlaubt einer Rolle/einem Bot nur, per Kanal-Overwrite eine
 * Berechtigung an eine ANDERE Rolle zu vergeben, wenn der Bot diese
 * Berechtigung selbst besitzt (effektive Guild-Berechtigung, da der Bot
 * selbst keinen eigenen Overwrite-Eintrag in buildOverwrites() erhaelt) -
 * andernfalls lehnt Discord den GESAMTEN Kanal-Anlegen-Aufruf mit demselben
 * generischen 403/50013 "Missing Permissions" ab wie bei einer fehlenden
 * "Kanaele verwalten"-Berechtigung. Ohne diese Vorab-Pruefung wuerde
 * createChannelOrThrow() faelschlich IMMER "Kanaele verwalten" als Ursache
 * melden, selbst wenn der Bot diese Berechtigung laengst hat und in
 * Wirklichkeit ein anderes, per Overwrite vergebenes Bit fehlt. Deckt NICHT
 * den separaten Discord-Sonderfall ab, dass reine Sprachkanal-Bits (Connect/
 * Speak/Mute/Deafen/Move) in den Overwrites eines TEXT-Kanals selbst dann
 * abgelehnt werden, wenn der Bot sie besitzt - dagegen schuetzt stattdessen
 * buildOverwrites()' includeVoicePermissions-Parameter, der diese Bits von
 * vornherein nur fuer den tatsaechlichen Sprachkanal in die Overwrites
 * aufnimmt. Wirft ValidationError mit den tatsaechlich fehlenden
 * Berechtigungen, statt zu raten.
 */
async function assertBotCanApplyOverwrites(
  guild: Guild,
  overwrites: readonly OverwriteResolvable[] | ReadonlyCollection<string, OverwriteResolvable>,
): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (me.permissions.has(PermissionFlagsBits.Administrator)) return;

  const required = new Set<bigint>([
    PermissionFlagsBits.ManageChannels,
    ...collectAllowedBits(overwrites),
  ]);
  const missing = [...required].filter((bit) => !me.permissions.has(bit));
  if (missing.length === 0) return;

  throw new ValidationError(
    'Mir fehlen folgende Berechtigungen, um diesen Kanal (inklusive der vorgesehenen Rollen-' +
      `Overwrites) anzulegen: ${missing.map(permissionLabel).join(', ')}. Ich kann per Kanal-` +
      'Overwrite keine Berechtigung an eine andere Rolle vergeben, die ich selbst nicht besitze - ' +
      'bitte pruefe meine Server-Berechtigungen entsprechend.',
  );
}

async function createChannelOrThrow(
  guild: Guild,
  options: GuildChannelCreateOptions,
): Promise<GuildBasedChannel> {
  await assertBotCanApplyOverwrites(guild, options.permissionOverwrites ?? []);

  try {
    return await guild.channels.create(options);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      // Die urspruengliche DiscordAPIError (inkl. rawError/requestBody) wird hier bewusst
      // NICHT weitergeworfen, da sie fuer Nutzer unverstaendlich waere - fuer die Diagnose
      // eines konkreten Falls (z. B. welches Overwrite/welcher Kanaltyp genau abgelehnt wurde)
      // aber unverzichtbar, deshalb hier vollstaendig geloggt statt verworfen.
      logger.error(
        { channelName: options.name, channelType: options.type, err: error },
        'Kanal-Anlage von Discord mit 50013 (Missing Permissions) abgelehnt, obwohl die ' +
          'Vorab-Pruefung (assertBotCanApplyOverwrites) keine fehlende Berechtigung fand.',
      );
      throw new ValidationError(
        'Mir fehlt eine Berechtigung, um diesen Kanal anzulegen (z. B. "Kanaele verwalten" oder ' +
          'eine per Overwrite vergebene Berechtigung). Bitte pruefe meine Server-Berechtigungen.',
      );
    }
    throw error;
  }
}

/**
 * Postet eine kurze, angepinnte Willkommensnachricht in einen frisch
 * angelegten Klassenkanal. Rein kosmetisch: schlaegt das Senden/Anpinnen fehl
 * (z. B. fehlende Berechtigung zum Anpinnen), bleibt der Kanal trotzdem
 * nutzbar - es wird nur eine Warnung geloggt, kein Abbruch des gesamten
 * Klassenbereichs-Setups wegen einer reinen Komfortfunktion.
 */
async function postWelcomeMessage(channel: GuildBasedChannel, text: string): Promise<void> {
  try {
    const message = await (channel as TextChannel).send(text);
    await message.pin();
  } catch (error) {
    logger.warn(
      { channelId: channel.id, err: error },
      'Willkommensnachricht konnte nicht gepostet oder angepinnt werden - Kanal bleibt nutzbar.',
    );
  }
}

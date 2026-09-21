import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
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
 * Bewusst AUSGESCHLOSSEN (niemals Teil dieser Liste oder einer Basis-Rollen-
 * berechtigung): Administrator, ManageGuild, ManageRoles, ManageChannels,
 * ManageWebhooks, KickMembers, BanMembers und jede andere serverweite Rechte-
 * Aenderung. "Termine/Events verwalten" wird bewusst NICHT ueber Discords
 * natives Server-Event-System (ManageEvents) abgebildet, da dieses Recht sich
 * in Discord nicht auf eine einzelne Klasse beschraenken laesst - stattdessen
 * bekommt die Klassenleitung volle Nachrichtenkontrolle im dedizierten
 * Termine-Kanal (siehe scheduleChannelId), was das eigentliche Bedürfnis
 * abdeckt, ohne serverweite Rechte zu vergeben (Fail-closed-Entscheidung).
 */
const CLASS_LEAD_CHANNEL_PERMISSIONS: bigint[] = [
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
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ModerateMembers,
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

  const category = await ensureCategory(guild, guildConfig, klasse);

  const channelsCreated: string[] = [];
  const channelsSkipped: string[] = [];
  const updates: ClassChannelUpdate = {};

  for (const blueprint of CHANNEL_BLUEPRINTS) {
    const existingId = klasse[blueprint.key];
    const existing = existingId ? await fetchChannelSafely(guild, existingId) : null;

    if (existing) {
      channelsSkipped.push(blueprint.name);
      continue;
    }

    const overwrites = buildOverwrites(guild, guildConfig, klasse, {
      classCanSend: !blueprint.readOnlyForClass,
    });

    const channel = await createChannelOrThrow(guild, {
      name: blueprint.name,
      type: blueprint.type,
      parent: category.id,
      permissionOverwrites: overwrites,
      ...(blueprint.topic ? { topic: blueprint.topic } : {}),
      reason: `Privater Klassenbereich fuer Klasse ${klasse.name}`,
    });

    updates[blueprint.key] = channel.id;
    channelsCreated.push(blueprint.name);

    if (blueprint.welcomeMessage && blueprint.type === ChannelType.GuildText) {
      await postWelcomeMessage(channel, blueprint.welcomeMessage);
    }
  }

  if (category.created) {
    updates.categoryId = category.id;
  }

  if (Object.keys(updates).length > 0) {
    await updateClassChannels(guildConfig.id, klasse.name as ClassName, updates);
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

async function ensureCategory(
  guild: Guild,
  guildConfig: GuildConfig,
  klasse: Class,
): Promise<{ id: string; created: boolean }> {
  if (klasse.categoryId) {
    const existing = await fetchChannelSafely(guild, klasse.categoryId);
    if (existing) return { id: existing.id, created: false };
  }

  const overwrites = buildOverwrites(guild, guildConfig, klasse, { classCanSend: true });
  const category = await createChannelOrThrow(guild, {
    name: `📁 Klasse ${klasse.name}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason: `Privater Klassenbereich fuer Klasse ${klasse.name}`,
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
  options: { classCanSend: boolean },
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  if (klasse.roleId) {
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ];
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
    overwrites.push({
      id: guildConfig.adminRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });
  }

  if (guildConfig.moderatorRoleId) {
    overwrites.push({
      id: guildConfig.moderatorRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers,
      ],
    });
  }

  if (klasse.leadRoleId) {
    overwrites.push({ id: klasse.leadRoleId, allow: CLASS_LEAD_CHANNEL_PERMISSIONS });
  }

  return overwrites;
}

async function fetchChannelSafely(guild: Guild, channelId: string): Promise<{ id: string } | null> {
  try {
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
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
 * Wirklichkeit z. B. "Verbinden"/"Sprechen" fehlt (beide werden von
 * buildOverwrites() auch fuer Text-Kanaele an Klassen-/Admin-Rolle vergeben,
 * nicht nur fuer den Sprachkanal). Wirft ValidationError mit den tatsaechlich
 * fehlenden Berechtigungen, statt zu raten.
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

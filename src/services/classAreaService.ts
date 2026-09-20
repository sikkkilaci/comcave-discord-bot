import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  type Guild,
  type GuildChannelCreateOptions,
  type OverwriteResolvable,
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
}

/**
 * Die sieben Kanaele eines privaten Klassenbereichs. Bewusst als feste,
 * deklarative Liste statt konfigurierbar - deckt die in der Anforderung
 * genannten Bereiche ab (Klassenchat, Ankuendigungen, Termine, Pruefungen,
 * Berichtsheft/Tagesberichte, Lernmaterial, Sprachkanal). Nur "Ankuendigungen"
 * ist eindeutig als Einweg-Kanal zu verstehen (read-only fuer die Klasse);
 * alle anderen bleiben voll beschreibbar, da z. B. das Berichtsheft von den
 * Mitgliedern selbst befuellt wird. Admins koennen einzelne Kanal-Berechtigungen
 * bei Bedarf manuell in Discord weiter anpassen.
 */
const CHANNEL_BLUEPRINTS: readonly ChannelBlueprint[] = [
  { key: 'chatChannelId', name: 'klassenchat', type: ChannelType.GuildText },
  {
    key: 'announcementChannelId',
    name: 'ankuendigungen',
    type: ChannelType.GuildText,
    readOnlyForClass: true,
  },
  { key: 'scheduleChannelId', name: 'termine', type: ChannelType.GuildText },
  { key: 'examChannelId', name: 'pruefungen', type: ChannelType.GuildText },
  { key: 'reportChannelId', name: 'berichtsheft', type: ChannelType.GuildText },
  { key: 'materialChannelId', name: 'lernmaterial', type: ChannelType.GuildText },
  { key: 'voiceChannelId', name: 'sprachkanal', type: ChannelType.GuildVoice },
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
      reason: `Privater Klassenbereich fuer Klasse ${klasse.name}`,
    });

    updates[blueprint.key] = channel.id;
    channelsCreated.push(blueprint.name);
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
    name: `Klasse ${klasse.name}`,
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

  if (klasse.leadRoleId) {
    overwrites.push({
      id: klasse.leadRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });
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

async function createChannelOrThrow(
  guild: Guild,
  options: GuildChannelCreateOptions,
): Promise<{ id: string }> {
  try {
    return await guild.channels.create(options);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        'Mir fehlt die Berechtigung "Kanaele verwalten", um den Klassenbereich anzulegen. ' +
          'Bitte pruefe meine Server-Berechtigungen.',
      );
    }
    throw error;
  }
}

import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  type ActionRowBuilder,
  type ButtonBuilder,
  type EmbedBuilder,
  type Guild,
  type OverwriteResolvable,
  type Role,
  type TextChannel,
} from 'discord.js';
import type { Class } from '@prisma/client';
import {
  getOrCreateGuildConfig,
  updateGuildConfig,
} from '../repositories/guildConfigRepository.js';
import { getClassByName, updateClassRole } from '../repositories/classRepository.js';
import { configureAdminRoles } from './guildConfigService.js';
import { setupClassArea, type ClassAreaSetupResult } from './classAreaService.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { buildVerificationPrompt, VERIFY_BUTTON_CUSTOM_ID } from '../bot/ui/verificationMessage.js';
import {
  buildClassSelectionMessage,
  CLASS_SELECT_CUSTOM_ID_PREFIX,
} from '../bot/ui/classMessage.js';
import { roleHasAdministrator } from '../bot/discordHelpers.js';
import { ValidationError } from '../utils/errors.js';
import { CLASS_NAMES, type ClassName } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';
import {
  ensureGlobalServerStructure,
  type GlobalServerStructureResult,
} from './globalServerStructureService.js';

const logger = createChildLogger('serverBootstrapService');

/** Discord-API-Fehlercode fuer "Missing Permissions" - dasselbe Muster wie in
 * classLeadService.ts/classAreaService.ts/discordRoleSync.ts. */
const DISCORD_MISSING_PERMISSIONS = 50013;

/**
 * Feste Namen fuer die vom Bootstrap automatisch angelegten Grundrollen/
 * -kanaele. Es gibt dafuer im bisherigen Code keine kanonische Konstante -
 * Admins konnten bislang jede beliebige, selbst gewaehlte Rolle/jeden Kanal
 * per Setup-Befehl referenzieren. Die Namen hier uebernehmen wortwoertlich
 * die Begriffe, die README.md/ARCHITECTURE.md fuer diese Rollen/Kanaele
 * bereits durchgaengig verwenden ("Verifiziert-Rolle", "Admin-Rolle",
 * "Moderator-Rolle", "#wo-bin-ich"), damit kein neuer Name erfunden wird.
 * Klassenrollen verwenden bewusst denselben "Klasse X"-Namen wie die private
 * Kategorie in classAreaService.ts (Rollen- und Kanalnamen leben in
 * getrennten Discord-Namensraeumen, daher keine Kollision).
 */
const VERIFIED_ROLE_NAME = 'Verifiziert';
const ADMIN_ROLE_NAME = 'Admin';
const MODERATOR_ROLE_NAME = 'Moderator';
const VERIFICATION_CHANNEL_NAME = '🔐-verifizierung';
const WHERE_AM_I_CHANNEL_NAME = '🧭-wo-bin-ich';
const LOG_CHANNEL_NAME = '📋-bot-log';

const VERIFICATION_CHANNEL_TOPIC =
  'Verifiziere dich hier, um vollen Zugriff auf den Server zu erhalten.';
const WHERE_AM_I_CHANNEL_TOPIC =
  'Wähle deine Klasse (A/B/C), um Zugriff auf deinen Klassenbereich zu erhalten.';
const LOG_CHANNEL_TOPIC = 'Reserviert für Bot-Ausgaben (aktuell ohne Schreiblogik).';

function classRoleName(name: ClassName): string {
  return `Klasse ${name}`;
}

export interface BootstrapObjectSummary {
  name: string;
  id: string;
  created: boolean;
}

export interface BootstrapClassSummary {
  role: BootstrapObjectSummary;
  area: ClassAreaSetupResult;
}

export interface BootstrapResult {
  verifiedRole: BootstrapObjectSummary;
  adminRole: BootstrapObjectSummary;
  moderatorRole: BootstrapObjectSummary;
  verificationChannel: BootstrapObjectSummary;
  whereAmIChannel: BootstrapObjectSummary;
  logChannel: BootstrapObjectSummary;
  globalStructure: GlobalServerStructureResult;
  classes: Record<ClassName, BootstrapClassSummary>;
  verificationMessagePosted: boolean;
  whereAmIMessagePosted: boolean;
  /** Nicht-blockierende Hinweise (z. B. Rollenhierarchie, fehlende Nacharbeiten). */
  warnings: string[];
}

/**
 * Serialisiert parallele /setup-server-Auffuehrungen fuer denselben Server
 * (In-Process-Lock): Discord bietet kein atomares "nur anlegen, falls nicht
 * vorhanden" fuer Rollen/Kanaele - zwei wirklich parallele Ausfuehrungen
 * koennten sonst beide "nicht gefunden" sehen und doppelte Objekte anlegen.
 * Schuetzt nur innerhalb dieses Bot-Prozesses; das Deployment betreibt genau
 * eine Bot-Instanz (siehe README "Setup"), eine verteilte Sperre ist daher
 * nicht noetig.
 */
const runningBootstraps = new Set<string>();

/**
 * Richtet einen (typischerweise leeren) Discord-Server vollstaendig fuer den
 * COMCAVE-Bot ein: Grundrollen (Verifiziert/Admin/Moderator), Klassenrollen
 * A/B/C, globale Kanaele (#wo-bin-ich, Verifizierung, Log) sowie - ueber die
 * bereits bestehenden Services - die privaten Klassenbereiche und die
 * dauerhaften Verifizierungs-/Klassenauswahl-Nachrichten. Vollstaendig
 * idempotent: bereits vorhandene Rollen/Kanaele (per gespeicherter ID oder,
 * falls noch nicht konfiguriert, per exaktem Namen) werden wiederverwendet
 * statt dupliziert; nichts Bestehendes wird geloescht oder umbenannt.
 *
 * Wirft ValidationError, wenn eine (neue oder wiederverwendete) Rolle
 * Administrator-Rechte traegt, wenn dem Bot eine noetige Berechtigung fehlt,
 * oder wenn fuer diesen Server bereits ein Bootstrap laeuft.
 */
export async function bootstrapServer(
  guild: Guild,
  actorDiscordId: string,
): Promise<BootstrapResult> {
  if (runningBootstraps.has(guild.id)) {
    throw new ValidationError(
      'Fuer diesen Server laeuft bereits ein /setup-server-Vorgang. Bitte warte, bis dieser ' +
        'abgeschlossen ist, bevor du den Befehl erneut ausfuehrst.',
    );
  }

  runningBootstraps.add(guild.id);
  try {
    return await runBootstrap(guild, actorDiscordId);
  } finally {
    runningBootstraps.delete(guild.id);
  }
}

async function runBootstrap(guild: Guild, actorDiscordId: string): Promise<BootstrapResult> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);

  // --- 1. Rollen: System-/Grundrollen + Klassenrollen (ID -> Name -> anlegen). ---
  const verifiedRole = await ensureManagedRole(
    guild,
    guildConfig.verifiedRoleId,
    VERIFIED_ROLE_NAME,
  );
  const adminRole = await ensureManagedRole(guild, guildConfig.adminRoleId, ADMIN_ROLE_NAME);
  const moderatorRole = await ensureManagedRole(
    guild,
    guildConfig.moderatorRoleId,
    MODERATOR_ROLE_NAME,
  );

  const classRoleEntries: Array<[ClassName, { role: Role; created: boolean }]> = [];
  for (const name of CLASS_NAMES) {
    const existingClass = await getClassByName(guild.id, name);
    const ensured = await ensureManagedRole(
      guild,
      existingClass?.roleId ?? null,
      classRoleName(name),
    );
    classRoleEntries.push([name, ensured]);
  }

  // Fail-closed wie bei allen bestehenden Setup-Befehlen: keine der
  // verwalteten Rollen darf Administrator-Rechte tragen - VOR jeder
  // Persistierung geprueft, damit ein Verstoss niemals einen halb
  // durchgefuehrten Bootstrap hinterlaesst.
  const rolesToCheck: Array<[string, Role]> = [
    [VERIFIED_ROLE_NAME, verifiedRole.role],
    [ADMIN_ROLE_NAME, adminRole.role],
    [MODERATOR_ROLE_NAME, moderatorRole.role],
    ...classRoleEntries.map(([name, ensured]): [string, Role] => [
      classRoleName(name),
      ensured.role,
    ]),
  ];
  for (const [label, role] of rolesToCheck) {
    if (roleHasAdministrator(role)) {
      throw new ValidationError(
        `Die Rolle "${role.name}" (vorgesehen als ${label}) hat Administrator-Rechte. Diese Rolle ` +
          'darf keine globalen Administratorrechte haben - bitte in Discord manuell entfernen und ' +
          '/setup-server erneut ausfuehren.',
      );
    }
  }

  const warnings = await checkBotRolePositions(
    guild,
    rolesToCheck.map(([, role]) => role),
  );

  // --- 2. Globale Kanaele (#wo-bin-ich, Verifizierung, Log). ---
  const verificationChannel = await ensureTextChannel(
    guild,
    guildConfig.welcomeChannelId,
    VERIFICATION_CHANNEL_NAME,
    undefined,
    VERIFICATION_CHANNEL_TOPIC,
  );
  const whereAmIChannel = await ensureTextChannel(
    guild,
    guildConfig.whereAmIChannelId,
    WHERE_AM_I_CHANNEL_NAME,
    undefined,
    WHERE_AM_I_CHANNEL_TOPIC,
  );
  const logChannel = await ensureTextChannel(
    guild,
    guildConfig.logChannelId,
    LOG_CHANNEL_NAME,
    buildLogChannelOverwrites(guild, adminRole.role.id),
    LOG_CHANNEL_TOPIC,
  );

  // --- 3. GuildConfig: Rollen/Kanal-IDs persistieren (bestehende Services/Repos). ---
  await configureAdminRoles(
    guild.id,
    { adminRole: adminRole.role, moderatorRole: moderatorRole.role },
    actorDiscordId,
  );
  await updateGuildConfig(guild.id, {
    verifiedRoleId: verifiedRole.role.id,
    welcomeChannelId: verificationChannel.channel.id,
    whereAmIChannelId: whereAmIChannel.channel.id,
    logChannelId: logChannel.channel.id,
  });

  // --- 4. Globale COMCAVE-Plattformstruktur. ---
  const refreshedGuildConfig = await getOrCreateGuildConfig(guild.id);
  const globalStructure = await ensureGlobalServerStructure(guild, refreshedGuildConfig, {
    [VERIFICATION_CHANNEL_NAME]: verificationChannel.channel.id,
    [WHERE_AM_I_CHANNEL_NAME]: whereAmIChannel.channel.id,
    [LOG_CHANNEL_NAME]: logChannel.channel.id,
  });

  // --- 5. Klassenkonfiguration + private Klassenbereiche (bestehender classAreaService). ---
  const classes = {} as Record<ClassName, BootstrapClassSummary>;
  for (const [name, ensured] of classRoleEntries) {
    const klasse = await updateClassRole(guild.id, name, ensured.role.id);
    const area = await setupClassArea(guild, refreshedGuildConfig, klasse, actorDiscordId);
    classes[name] = {
      role: summary(classRoleName(name), ensured.role.id, ensured.created),
      area,
    };
  }

  await logAuditEvent({
    guildId: guild.id,
    actorDiscordId,
    action: 'server.bootstrap',
    metadata: {
      verifiedRoleCreated: verifiedRole.created,
      adminRoleCreated: adminRole.created,
      moderatorRoleCreated: moderatorRole.created,
      verificationChannelCreated: verificationChannel.created,
      whereAmIChannelCreated: whereAmIChannel.created,
      logChannelCreated: logChannel.created,
      globalCategoriesCreated: globalStructure.categoriesCreated,
      globalChannelsCreated: globalStructure.channelsCreated,
      classRolesCreated: Object.fromEntries(
        classRoleEntries.map(([name, ensured]) => [name, ensured.created]),
      ),
    },
  });

  // --- 6. Verifizierung + #wo-bin-ich: dauerhafte Nachrichten (nur, wenn noch keine vorhanden). ---
  const verificationMessagePosted = await ensureBotMessage(
    verificationChannel.channel,
    (customId) => customId === VERIFY_BUTTON_CUSTOM_ID,
    () => buildVerificationPrompt(),
  );
  const whereAmIMessagePosted = await ensureBotMessage(
    whereAmIChannel.channel,
    (customId) => customId.startsWith(CLASS_SELECT_CUSTOM_ID_PREFIX),
    () => buildClassSelectionMessage(null),
  );

  // --- 7. Abschliessende Konsistenzpruefung. ---
  warnings.push(...(await checkConsistency(guild.id)));

  logger.info(
    { guildId: guild.id, actor: actorDiscordId, warningsCount: warnings.length },
    'Server-Bootstrap abgeschlossen',
  );

  return {
    verifiedRole: summary(VERIFIED_ROLE_NAME, verifiedRole.role.id, verifiedRole.created),
    adminRole: summary(ADMIN_ROLE_NAME, adminRole.role.id, adminRole.created),
    moderatorRole: summary(MODERATOR_ROLE_NAME, moderatorRole.role.id, moderatorRole.created),
    verificationChannel: summary(
      VERIFICATION_CHANNEL_NAME,
      verificationChannel.channel.id,
      verificationChannel.created,
    ),
    whereAmIChannel: summary(
      WHERE_AM_I_CHANNEL_NAME,
      whereAmIChannel.channel.id,
      whereAmIChannel.created,
    ),
    logChannel: summary(LOG_CHANNEL_NAME, logChannel.channel.id, logChannel.created),
    globalStructure,
    classes,
    verificationMessagePosted,
    whereAmIMessagePosted,
    warnings,
  };
}

function summary(name: string, id: string, created: boolean): BootstrapObjectSummary {
  return { name, id, created };
}

/**
 * Liefert eine verwaltete Rolle: zuerst per gespeicherter ID (Selbstheilung,
 * falls die ID nicht mehr aufloesbar ist - analog zu classLeadService.ts),
 * sonst per exaktem Namensabgleich unter allen Rollen des Servers (deckt den
 * Fall ab, dass ein Admin die Rolle bereits manuell mit dem erwarteten Namen
 * angelegt hat), sonst wird sie neu angelegt (immer mit `permissions: []` -
 * keine Basis-Berechtigung, siehe classLeadService.ts fuer dasselbe Muster).
 */
async function ensureManagedRole(
  guild: Guild,
  storedId: string | null | undefined,
  name: string,
): Promise<{ role: Role; created: boolean }> {
  if (storedId) {
    const existing = await fetchRoleSafely(guild, storedId);
    if (existing) return { role: existing, created: false };
  }

  const existingByName = await findRoleByName(guild, name);
  if (existingByName) return { role: existingByName, created: false };

  const role = await createRoleOrThrow(guild, {
    name,
    permissions: [],
    mentionable: false,
    hoist: false,
    reason: `COMCAVE-Server-Bootstrap: Rolle "${name}" angelegt`,
  });
  return { role, created: true };
}

async function fetchRoleSafely(guild: Guild, roleId: string): Promise<Role | null> {
  try {
    return await guild.roles.fetch(roleId);
  } catch {
    return null;
  }
}

async function findRoleByName(guild: Guild, name: string): Promise<Role | null> {
  const roles = await guild.roles.fetch();
  return roles.find((role) => role.name === name) ?? null;
}

async function createRoleOrThrow(
  guild: Guild,
  options: Parameters<Guild['roles']['create']>[0],
): Promise<Role> {
  try {
    return await guild.roles.create(options);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        `Mir fehlt die Berechtigung "Rollen verwalten", um eine benoetigte Rolle anzulegen. ` +
          'Bitte pruefe meine Server-Berechtigungen.',
      );
    }
    throw error;
  }
}

/**
 * Liefert einen verwalteten Textkanal nach demselben ID -> Name -> Anlegen-
 * Muster wie ensureManagedRole(). `overwrites` wird nur beim Neuanlegen
 * gesetzt - ein bereits vorhandener (wiederverwendeter) Kanal wird nicht
 * nachtraeglich in seinen Berechtigungen veraendert (keine unerwuenschte
 * Ueberschreibung bestehender, ggf. bewusst manuell angepasster Overwrites).
 */
async function ensureTextChannel(
  guild: Guild,
  storedId: string | null | undefined,
  name: string,
  overwrites?: OverwriteResolvable[],
  topic?: string,
): Promise<{ channel: TextChannel; created: boolean }> {
  if (storedId) {
    const existing = await fetchTextChannelSafely(guild, storedId);
    if (existing) return { channel: existing, created: false };
  }

  const existingByName = await findTextChannelByName(guild, name);
  if (existingByName) return { channel: existingByName, created: false };

  const channel = await createChannelOrThrow(guild, {
    name,
    type: ChannelType.GuildText,
    ...(overwrites ? { permissionOverwrites: overwrites } : {}),
    ...(topic ? { topic } : {}),
    reason: `COMCAVE-Server-Bootstrap: Kanal "${name}" angelegt`,
  });
  return { channel, created: true };
}

async function fetchTextChannelSafely(
  guild: Guild,
  channelId: string,
): Promise<TextChannel | null> {
  try {
    const channel = await guild.channels.fetch(channelId);
    return channel && channel.type === ChannelType.GuildText ? channel : null;
  } catch {
    return null;
  }
}

async function findTextChannelByName(guild: Guild, name: string): Promise<TextChannel | null> {
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (channel && channel.type === ChannelType.GuildText && channel.name === name) {
      return channel;
    }
  }
  return null;
}

async function createChannelOrThrow(
  guild: Guild,
  options: {
    name: string;
    type: ChannelType.GuildText;
    permissionOverwrites?: OverwriteResolvable[];
    topic?: string;
    reason: string;
  },
): Promise<TextChannel> {
  try {
    return await guild.channels.create(options);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        `Mir fehlt die Berechtigung "Kanaele verwalten", um den Kanal "${options.name}" anzulegen. ` +
          'Bitte pruefe meine Server-Berechtigungen.',
      );
    }
    throw error;
  }
}

/** @everyone verliert Sichtbarkeit; nur die Admin-Rolle sieht den Log-Kanal. */
function buildLogChannelOverwrites(guild: Guild, adminRoleId: string): OverwriteResolvable[] {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: adminRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
}

/**
 * Postet eine dauerhafte Bot-Nachricht (Verifizierung/Klassenauswahl) nur,
 * wenn im Kanal noch keine passende (per Button-customId erkannte) Nachricht
 * existiert - verhindert Duplikate sowohl bei einem neu angelegten als auch
 * bei einem wiederverwendeten, bereits manuell existierenden Kanal.
 */
async function ensureBotMessage(
  channel: TextChannel,
  matchesButton: (customId: string) => boolean,
  buildMessage: () => { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] },
): Promise<boolean> {
  const alreadyPosted = await channelHasMatchingMessage(channel, matchesButton);
  if (alreadyPosted) return false;

  try {
    await channel.send(buildMessage());
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        `Mir fehlt die Berechtigung, eine Nachricht in ${channel} zu senden. ` +
          'Bitte pruefe meine Kanal-Berechtigungen (Nachrichten senden, Embeds einbetten).',
      );
    }
    throw error;
  }
}

async function channelHasMatchingMessage(
  channel: TextChannel,
  matchesButton: (customId: string) => boolean,
): Promise<boolean> {
  let recentMessages;
  try {
    recentMessages = await channel.messages.fetch({ limit: 20 });
  } catch {
    return false;
  }

  for (const message of recentMessages.values()) {
    for (const row of message.components ?? []) {
      for (const component of (row as { components?: Array<{ customId?: string | null }> })
        .components ?? []) {
        if (component.customId && matchesButton(component.customId)) return true;
      }
    }
  }
  return false;
}

/**
 * Informativer, nicht-blockierender Hinweis: Discord erlaubt zwar das
 * Anlegen von Rollen unabhaengig von der Rollenhierarchie, aber eine spaetere
 * Zuweisung/Entziehung (z. B. Verifizierung, Klassenwahl) schlaegt fehl, wenn
 * die hoechste Bot-Rolle nicht ueber der jeweiligen Rolle steht (siehe
 * discordRoleSync.ts). Der Bootstrap bricht deswegen nicht ab, meldet es aber
 * als Warnung, damit es vor dem eigentlichen E2E-Test behoben werden kann.
 */
async function checkBotRolePositions(guild: Guild, managedRoles: Role[]): Promise<string[]> {
  let me;
  try {
    me = guild.members.me ?? (await guild.members.fetchMe());
  } catch {
    return [];
  }

  const tooLow = managedRoles
    .filter((role) => role.position >= me.roles.highest.position)
    .map((role) => role.name);
  if (tooLow.length === 0) return [];

  return [
    `Meine hoechste Rolle steht nicht ueber folgenden Rollen, daher kann ich sie zwar anlegen, ` +
      `spaeter aber keinem Mitglied zuweisen/entziehen: ${tooLow.join(', ')}. Bitte meine Bot-Rolle ` +
      'in Discord (Server-Einstellungen -> Rollen) ueber diese Rollen verschieben.',
  ];
}

const CLASS_CHANNEL_FIELDS: Array<keyof Class> = [
  'chatChannelId',
  'announcementChannelId',
  'scheduleChannelId',
  'examChannelId',
  'reportChannelId',
  'materialChannelId',
  'voiceChannelId',
];

/**
 * Liest den tatsaechlich in der DB persistierten Zustand nach dem Bootstrap
 * erneut aus und meldet jede Luecke als Warnung, statt sie stillschweigend
 * zu ignorieren - eine letzte Absicherung zusaetzlich zu den bereits oben
 * geworfenen Fehlern (die bei einem echten Problem den Bootstrap ohnehin
 * schon vorher abgebrochen haetten).
 */
async function checkConsistency(guildId: string): Promise<string[]> {
  const warnings: string[] = [];
  const guildConfig = await getOrCreateGuildConfig(guildId);

  if (!guildConfig.verifiedRoleId)
    warnings.push('Verifiziert-Rolle ist nach dem Bootstrap nicht gesetzt.');
  if (!guildConfig.adminRoleId) warnings.push('Admin-Rolle ist nach dem Bootstrap nicht gesetzt.');
  if (!guildConfig.whereAmIChannelId) {
    warnings.push('#wo-bin-ich-Kanal ist nach dem Bootstrap nicht gesetzt.');
  }
  if (!guildConfig.welcomeChannelId) {
    warnings.push('Verifizierungs-Kanal ist nach dem Bootstrap nicht gesetzt.');
  }

  for (const name of CLASS_NAMES) {
    const klasse = await getClassByName(guildId, name);
    if (!klasse?.roleId) {
      warnings.push(`Klasse ${name} hat nach dem Bootstrap keine Rolle.`);
      continue;
    }
    if (!klasse.categoryId) {
      warnings.push(
        `Klasse ${name} hat nach dem Bootstrap keine Kategorie fuer den privaten Bereich.`,
      );
    }
    const missing = CLASS_CHANNEL_FIELDS.filter((field) => !klasse[field]);
    if (missing.length > 0) {
      warnings.push(`Klasse ${name} fehlen ${missing.length} Kanaele im privaten Bereich.`);
    }
  }

  return warnings;
}

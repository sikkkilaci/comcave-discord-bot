import {
  DiscordAPIError,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';
import type { Class, GuildConfig } from '@prisma/client';
import {
  getClassByName,
  getClassLedByMember,
  updateClassLead,
} from '../repositories/classRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { addRoleOrThrow, removeRoleOrThrow } from './discordRoleSync.js';
import { ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('classLeadService');

/** Discord-API-Fehlercode fuer "Missing Permissions". */
const DISCORD_MISSING_PERMISSIONS = 50013;

export interface ClassLeadAssignmentResult {
  className: string;
  leadRoleCreated: boolean;
  /** Vorherige Klassenleitung dieser Klasse, falls jemand ersetzt wurde. */
  previousLeadDiscordId: string | null;
  /** Falls die Person zuvor Klassenleitung einer ANDEREN Klasse war, deren Name. */
  reassignedFromClassName: string | null;
  newLeadDiscordId: string;
}

export interface ClassLeadRemovalResult {
  className: string;
  /** false, wenn die Klasse ohnehin schon keine zugewiesene Klassenleitung hatte. */
  changed: boolean;
  removedDiscordId: string | null;
}

/**
 * Weist einem Mitglied die Klassenleitung einer Klasse zu. Legt die
 * Klassenleitungs-Rolle bei Bedarf an (immer mit `permissions: []` - alle
 * Rechte kommen ausschliesslich aus den Kanal-Overwrites in classAreaService.ts,
 * niemals aus einer Basis-Rollenberechtigung). Eine Person ist immer nur
 * Klassenleitung genau einer Klasse: haelt sie bereits eine andere Klassen-
 * leitung, wird diese sauber entfernt; ersetzt sie eine bestehende
 * Klassenleitung derselben Klasse, wird dieser Person die Rolle entzogen.
 *
 * Nur fuer Aufrufer gedacht, die bereits als globaler Admin autorisiert sind
 * (siehe /setup-klassenleitung, permissionLevel ADMIN) - diese Funktion prueft
 * die Berechtigung des Aufrufers selbst nicht, analog zu assignClass().
 *
 * Wirft ValidationError, wenn die Klasse noch nicht konfiguriert ist (keine
 * Klassenrolle), wenn eine bestehende Klassenleitungs-Rolle Administrator-
 * Rechte traegt (Fail-closed-Sicherheitscheck, falls die Rolle manuell
 * veraendert wurde), oder wenn dem Bot die noetige Berechtigung fehlt.
 */
export async function assignClassLead(
  guild: Guild,
  guildConfig: GuildConfig,
  className: ClassName,
  targetMember: GuildMember,
  actorDiscordId: string,
): Promise<ClassLeadAssignmentResult> {
  const targetClass = await getClassByName(guildConfig.id, className);
  if (!targetClass || !targetClass.roleId) {
    throw new ValidationError(
      `Klasse ${className} ist noch nicht konfiguriert. Ein Admin muss zuerst /setup-klassen ausfuehren.`,
    );
  }

  const { role: leadRole, created: leadRoleCreated } = await ensureLeadRole(guild, targetClass);
  await assertRoleHasNoAdministrator(leadRole, targetClass.name);

  let reassignedFromClassName: string | null = null;

  const otherClassLedByTarget = await getClassLedByMember(
    guildConfig.id,
    targetMember.id,
    targetClass.id,
  );
  if (otherClassLedByTarget) {
    await releaseClassLead(guild, otherClassLedByTarget, 'Klassenleitung: Wechsel der Klasse');
    reassignedFromClassName = otherClassLedByTarget.name;
  }

  const previousLeadDiscordId = targetClass.leadDiscordId;
  if (previousLeadDiscordId && previousLeadDiscordId !== targetMember.id) {
    await releaseClassLead(guild, targetClass, 'Klassenleitung: neue Person zugewiesen');
  }

  if (!targetMember.roles.cache.has(leadRole.id)) {
    await addRoleOrThrow(
      targetMember,
      leadRole.id,
      `Klassenleitung fuer Klasse ${className} zugewiesen`,
    );
  }

  await updateClassLead(guildConfig.id, className, {
    leadRoleId: leadRole.id,
    leadDiscordId: targetMember.id,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action:
      previousLeadDiscordId || otherClassLedByTarget ? 'class.lead_change' : 'class.lead_assign',
    targetDiscordId: targetMember.id,
    metadata: {
      className,
      leadRoleCreated,
      previousLeadDiscordId,
      reassignedFromClassName,
    },
  });

  logger.info(
    { guildId: guildConfig.id, className, member: targetMember.id, actor: actorDiscordId },
    'Klassenleitung zugewiesen',
  );

  return {
    className,
    leadRoleCreated,
    previousLeadDiscordId,
    reassignedFromClassName,
    newLeadDiscordId: targetMember.id,
  };
}

/**
 * Entfernt die aktuell zugewiesene Klassenleitung einer Klasse (falls
 * vorhanden). Die Rolle selbst bleibt bestehen (`leadRoleId` unveraendert),
 * nur die Zuweisung (`leadDiscordId`) und die Discord-Rolle der Person werden
 * entfernt, damit die Rolle bei einer spaeteren Neuzuweisung wiederverwendet
 * werden kann, ohne erneut angelegt zu werden.
 */
export async function removeClassLead(
  guild: Guild,
  guildConfig: GuildConfig,
  className: ClassName,
  actorDiscordId: string,
): Promise<ClassLeadRemovalResult> {
  const targetClass = await getClassByName(guildConfig.id, className);
  if (!targetClass) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }

  if (!targetClass.leadDiscordId) {
    return { className, changed: false, removedDiscordId: null };
  }

  const removedDiscordId = targetClass.leadDiscordId;
  await releaseClassLead(guild, targetClass, 'Klassenleitung entfernt');

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'class.lead_remove',
    targetDiscordId: removedDiscordId,
    metadata: { className },
  });

  logger.info(
    { guildId: guildConfig.id, className, removedMember: removedDiscordId, actor: actorDiscordId },
    'Klassenleitung entfernt',
  );

  return { className, changed: true, removedDiscordId };
}

/**
 * Entzieht der aktuell fuer `klasse` hinterlegten Person (`leadDiscordId`)
 * die Klassenleitungs-Rolle - sofern sie noch auf dem Server und im
 * Rollen-Cache auffindbar ist, sonst wird der DB-Zustand trotzdem bereinigt -
 * und setzt `leadDiscordId` auf null. `leadRoleId` bleibt unangetastet.
 */
async function releaseClassLead(guild: Guild, klasse: Class, reason: string): Promise<void> {
  if (klasse.leadDiscordId && klasse.leadRoleId) {
    const previousMember = await fetchMemberSafely(guild, klasse.leadDiscordId);
    if (previousMember && previousMember.roles.cache.has(klasse.leadRoleId)) {
      await removeRoleOrThrow(previousMember, klasse.leadRoleId, reason);
    }
  }

  await updateClassLead(klasse.guildId, klasse.name as ClassName, {
    leadDiscordId: null,
  });
}

/**
 * Stellt sicher, dass die Klasse eine gueltige Klassenleitungs-Rolle hat:
 * vorhandene Rolle wird per ID gegengeprueft (falls z. B. manuell in Discord
 * geloescht, wird sie neu angelegt - Selbstheilung analog zu classAreaService.ts),
 * sonst wird eine neue Rolle ohne jegliche Basis-Berechtigung erstellt.
 */
async function ensureLeadRole(
  guild: Guild,
  klasse: Class,
): Promise<{ role: Role; created: boolean }> {
  if (klasse.leadRoleId) {
    const existing = await fetchRoleSafely(guild, klasse.leadRoleId);
    if (existing) return { role: existing, created: false };
  }

  const role = await createRoleOrThrow(guild, {
    name: `Klassenleitung ${klasse.name}`,
    permissions: [],
    mentionable: false,
    hoist: false,
    reason: `Klassenleitungs-Rolle fuer Klasse ${klasse.name}`,
  });

  return { role, created: true };
}

/**
 * Fail-closed-Sicherheitscheck: selbst wenn eine bestehende Klassenleitungs-
 * Rolle nachtraeglich manuell in Discord mit Administrator-Rechten versehen
 * wurde, wird jede weitere Zuweisung ueber den Bot verweigert, bis ein Admin
 * das korrigiert hat.
 */
async function assertRoleHasNoAdministrator(role: Role, className: string): Promise<void> {
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new ValidationError(
      `Die Klassenleitungs-Rolle von Klasse ${className} hat Administrator-Rechte. ` +
        'Bitte diese Berechtigung in Discord manuell entfernen, bevor eine Zuweisung erfolgen kann.',
    );
  }
}

async function fetchMemberSafely(guild: Guild, discordId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(discordId);
  } catch {
    return null;
  }
}

async function fetchRoleSafely(guild: Guild, roleId: string): Promise<Role | null> {
  try {
    return await guild.roles.fetch(roleId);
  } catch {
    return null;
  }
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
        'Mir fehlt die Berechtigung "Rollen verwalten", um die Klassenleitungs-Rolle anzulegen. ' +
          'Bitte pruefe meine Server-Berechtigungen.',
      );
    }
    throw error;
  }
}

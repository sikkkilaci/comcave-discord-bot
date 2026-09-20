import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { prisma } from '../db/client.js';
import { PermissionLevel } from './PermissionLevel.js';

/** Serverbesitzer und Discord-"Administrator"-Rechteinhaber gelten immer als Bot-Admin. */
export function isServerAdmin(member: GuildMember, guildConfig: GuildConfig): boolean {
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (guildConfig.adminRoleId && member.roles.cache.has(guildConfig.adminRoleId)) return true;
  return false;
}

export function isVerified(member: GuildMember, guildConfig: GuildConfig): boolean {
  if (!guildConfig.verifiedRoleId) return false;
  return member.roles.cache.has(guildConfig.verifiedRoleId);
}

/**
 * Prueft, ob das Mitglied Klassenleitung irgendeiner Klasse auf dem Server ist.
 * Fuer die Einschraenkung auf die *eigene* Klasse siehe isClassLeadOf().
 */
export async function isAnyClassLead(member: GuildMember): Promise<boolean> {
  const classes = await prisma.class.findMany({
    where: { guildId: member.guild.id, leadRoleId: { not: null } },
    select: { leadRoleId: true },
  });
  return classes.some(
    (klasse) => klasse.leadRoleId !== null && member.roles.cache.has(klasse.leadRoleId),
  );
}

/** Prueft, ob das Mitglied Klassenleitung genau der uebergebenen Klasse ist. */
export function isClassLeadOf(member: GuildMember, klasse: { leadRoleId: string | null }): boolean {
  if (!klasse.leadRoleId) return false;
  return member.roles.cache.has(klasse.leadRoleId);
}

/**
 * Generische Pruefung fuer eine globale Mindest-Berechtigungsstufe, wie sie
 * Slash-Commands ueber `permissionLevel` deklarieren. Fuer Aktionen, die sich
 * auf eine bestimmte Klasse beziehen, muss zusaetzlich isClassLeadOf() bzw.
 * die Zugehoerigkeit zur Klasse in der Command-Logik selbst geprueft werden.
 */
export async function hasPermissionLevel(
  member: GuildMember,
  guildConfig: GuildConfig,
  level: PermissionLevel,
): Promise<boolean> {
  if (level === PermissionLevel.EVERYONE) return true;
  if (isServerAdmin(member, guildConfig)) return true;

  switch (level) {
    case PermissionLevel.VERIFIED:
      return isVerified(member, guildConfig);
    case PermissionLevel.KLASSENLEITUNG:
      return isAnyClassLead(member);
    case PermissionLevel.ADMIN:
      return false; // isServerAdmin() oben haette bereits true zurueckgegeben
    default:
      return false;
  }
}

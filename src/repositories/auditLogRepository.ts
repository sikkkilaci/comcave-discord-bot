import type { AuditLogEntry } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface AuditEventInput {
  guildId: string;
  actorDiscordId: string;
  action: string;
  targetDiscordId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Schreibt einen Eintrag ins zentrale Audit-Log. Der zugehoerige GuildConfig-
 * Datensatz muss bereits existieren (Fremdschluessel) - Aufrufer stellen das
 * ueblicherweise ueber getOrCreateGuildConfig() sicher, bevor sie hierher
 * gelangen.
 */
export async function logAuditEvent(event: AuditEventInput): Promise<void> {
  await prisma.auditLogEntry.create({
    data: {
      guildId: event.guildId,
      actorDiscordId: event.actorDiscordId,
      action: event.action,
      targetDiscordId: event.targetDiscordId ?? null,
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    },
  });
}

export interface AuditEventQueryOptions {
  targetDiscordId?: string;
  actorDiscordId?: string;
  action?: string;
}

function buildAuditEventWhere(guildId: string, options: AuditEventQueryOptions) {
  return {
    guildId,
    ...(options.targetDiscordId ? { targetDiscordId: options.targetDiscordId } : {}),
    ...(options.actorDiscordId ? { actorDiscordId: options.actorDiscordId } : {}),
    ...(options.action ? { action: options.action } : {}),
  };
}

/**
 * Liest Audit-Log-Eintraege eines Servers, neueste zuerst. Optional nach
 * betroffenem Mitglied, ausfuehrendem Mitglied und/oder Aktion gefiltert.
 * `take`/`skip` ermoeglichen Paginierung (siehe getAuditLogPage() in
 * auditLogService.ts), ohne dass jeder Aufrufer selbst eine Prisma-Query
 * bauen muss.
 */
export async function listAuditEvents(
  guildId: string,
  options: AuditEventQueryOptions & { take?: number; skip?: number } = {},
): Promise<AuditLogEntry[]> {
  return prisma.auditLogEntry.findMany({
    where: buildAuditEventWhere(guildId, options),
    orderBy: { createdAt: 'desc' },
    ...(options.take !== undefined ? { take: options.take } : {}),
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
  });
}

/** Zaehlt Audit-Log-Eintraege eines Servers mit denselben Filtern wie listAuditEvents(), fuer Paginierung. */
export async function countAuditEvents(
  guildId: string,
  options: AuditEventQueryOptions = {},
): Promise<number> {
  return prisma.auditLogEntry.count({ where: buildAuditEventWhere(guildId, options) });
}

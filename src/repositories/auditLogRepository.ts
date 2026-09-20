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

/** Liest Audit-Log-Eintraege eines Servers, neueste zuerst. Optional nach betroffenem Mitglied gefiltert. */
export async function listAuditEvents(
  guildId: string,
  options: { targetDiscordId?: string } = {},
): Promise<AuditLogEntry[]> {
  return prisma.auditLogEntry.findMany({
    where: {
      guildId,
      ...(options.targetDiscordId ? { targetDiscordId: options.targetDiscordId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

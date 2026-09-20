import type { AuditLogEntry, GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import {
  countAuditEvents,
  listAuditEvents,
  type AuditEventQueryOptions,
} from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { PermissionError, ValidationError } from '../utils/errors.js';

const PAGE_SIZE = 10;

export interface AuditLogFilter {
  aktion?: string;
  ausfuehrenderDiscordId?: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Liefert eine Seite des Audit-Logs eines Servers. Nur globale Admins duerfen
 * das Audit-Log einsehen (isServerAdmin()) - dieselbe zentrale Pruefung wie
 * ueberall sonst, keine zweite Berechtigungslogik. Explizit auch hier in der
 * Service-Schicht geprueft (nicht nur ueber permissionLevel: ADMIN am
 * Command), damit die Regel unabhaengig von der Command-Anbindung gilt und
 * direkt testbar ist - Klassenleitung hat KEINEN erweiterten Zugriff, auch
 * nicht auf Eintraege der eigenen Klasse.
 */
export async function getAuditLogPage(
  guildConfig: GuildConfig,
  member: GuildMember,
  page: number,
  filter: AuditLogFilter = {},
): Promise<AuditLogPage> {
  if (!isServerAdmin(member, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen das Audit-Log einsehen.');
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('Die Seitenzahl muss eine positive ganze Zahl sein.');
  }

  const queryOptions: AuditEventQueryOptions = {
    ...(filter.aktion !== undefined ? { action: filter.aktion } : {}),
    ...(filter.ausfuehrenderDiscordId !== undefined
      ? { actorDiscordId: filter.ausfuehrenderDiscordId }
      : {}),
  };

  const totalCount = await countAuditEvents(guildConfig.id, queryOptions);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  if (totalCount > 0 && page > totalPages) {
    throw new ValidationError(`Es gibt nur ${totalPages} Seite(n) fuer diesen Filter.`);
  }

  const entries = await listAuditEvents(guildConfig.id, {
    ...queryOptions,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  return { entries, page, pageSize: PAGE_SIZE, totalCount, totalPages };
}

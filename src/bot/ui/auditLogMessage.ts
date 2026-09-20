import { EmbedBuilder } from 'discord.js';
import type { AuditLogPage } from '../../services/auditLogService.js';
import { formatGermanDateTime } from '../../utils/dateTime.js';

/** Bestes-Effort-Auslesen des `className`-Felds, das nahezu jeder klassenbezogene Audit-Log-Eintrag in `metadata` mitfuehrt. */
function extractClassName(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (parsed && typeof parsed === 'object' && 'className' in parsed) {
      const value = (parsed as Record<string, unknown>).className;
      return typeof value === 'string' ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Baut die Audit-Log-Anzeige als Embed - eine Seite mit bis zu zehn
 * Eintraegen (siehe getAuditLogPage() in auditLogService.ts), neueste zuerst.
 * Zeigt pro Eintrag Zeitpunkt, Aktion, ausfuehrenden Nutzer, betroffenen
 * Nutzer (falls vorhanden), betroffene Klasse (falls aus den Metadaten
 * ablesbar) sowie die restlichen Metadaten als kompaktes JSON.
 */
export function buildAuditLogEmbed(result: AuditLogPage): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('🛡️ Audit-Log').setColor(0x2b2d31);

  if (result.entries.length === 0) {
    return embed.setDescription('Es sind keine Audit-Log-Eintraege vorhanden.');
  }

  for (const entry of result.entries) {
    const lines = [
      `Ausgefuehrt von <@${entry.actorDiscordId}>`,
      ...(entry.targetDiscordId ? [`Betroffen: <@${entry.targetDiscordId}>`] : []),
    ];
    const className = extractClassName(entry.metadata);
    if (className) {
      lines.push(`Klasse: ${className}`);
    }
    if (entry.metadata) {
      lines.push(`Metadaten: \`${entry.metadata}\``);
    }
    embed.addFields({
      name: `${formatGermanDateTime(entry.createdAt)} - ${entry.action}`,
      value: lines.join('\n').slice(0, 1024),
    });
  }

  embed.setFooter({
    text: `Seite ${result.page}/${result.totalPages} - ${result.totalCount} Eintraege insgesamt`,
  });

  return embed;
}

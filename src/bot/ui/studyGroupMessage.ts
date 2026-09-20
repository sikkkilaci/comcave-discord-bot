import { EmbedBuilder } from 'discord.js';
import type { StudyGroupListItem, StudyGroupStatusItem } from '../../services/studyGroupService.js';
import { CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import { formatGermanDateTime } from '../../utils/dateTime.js';

/** Discord erlaubt maximal 25 Felder pro Embed. */
const MAX_LISTED_ITEMS = 25;
/** Discord erlaubt maximal 1024 Zeichen je Embed-Feld. */
const MAX_FIELD_LENGTH = 1024;

/**
 * Baut die Liste der aktiven Lerngruppen einer Klasse fuer
 * `/lerngruppen-anzeigen`. Jede Gruppe zeigt ihre ID mit an, da Beitreten/
 * Verlassen/Schliessen die Gruppe ueber genau diese ID identifizieren (kein
 * interaktives Auswahl-Menu fuer diesen ersten Ausbauschritt, dieselbe
 * Konvention wie bei Pruefungen/Terminen/Lernmaterial).
 */
export function buildStudyGroupListEmbed(
  className: ClassName,
  items: StudyGroupListItem[],
  voiceChannelId: string | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Lerngruppen - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (voiceChannelId) {
    embed.setDescription(`Zum gemeinsamen Lernen per Voice: <#${voiceChannelId}>`);
  }

  if (items.length === 0) {
    return embed.setDescription(
      [embed.data.description, 'Aktuell sind keine Lerngruppen eingetragen.']
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  for (const { group, memberCount } of items.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [
      group.maxParticipants
        ? `Teilnehmer: ${memberCount}/${group.maxParticipants}`
        : `Teilnehmer: ${memberCount}`,
      `ID: \`${group.id}\``,
    ];
    embed.addFields({ name: group.name, value: lines.join('\n') });
  }

  if (items.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${items.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

/**
 * Baut die Verwaltungssicht fuer Klassenleitung/Admin (`/lerngruppe-status`):
 * alle Gruppen (aktiv und geschlossen) mit vollstaendiger Mitgliederliste.
 */
export function buildStudyGroupStatusEmbed(
  className: ClassName,
  items: StudyGroupStatusItem[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Lerngruppen-Status - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (items.length === 0) {
    return embed.setDescription('Aktuell sind keine Lerngruppen eingetragen.');
  }

  for (const { group, memberDiscordIds } of items.slice(0, MAX_LISTED_ITEMS)) {
    const statusLabel = group.isActive
      ? 'aktiv'
      : `geschlossen am ${group.closedAt ? formatGermanDateTime(group.closedAt) : 'unbekannt'}`;
    const lines = [
      `Status: ${statusLabel}`,
      group.maxParticipants
        ? `Teilnehmer (${memberDiscordIds.length}/${group.maxParticipants}): `
        : `Teilnehmer (${memberDiscordIds.length}): `,
    ];
    const memberList = memberDiscordIds.length
      ? memberDiscordIds.map((id) => `<@${id}>`).join(', ')
      : 'niemand';
    lines[lines.length - 1] += memberList;
    lines.push(`ID: \`${group.id}\``);

    embed.addFields({ name: group.name, value: lines.join('\n').slice(0, MAX_FIELD_LENGTH) });
  }

  if (items.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${items.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

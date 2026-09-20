import { EmbedBuilder } from 'discord.js';
import type { DailyReport, WeeklyReport } from '@prisma/client';
import { CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import { formatGermanDate } from '../../utils/dateTime.js';
import type { BerichtsheftEntry } from '../../services/berichtsheftService.js';

/** Discord erlaubt maximal 25 Felder pro Embed. */
const MAX_LISTED_ITEMS = 25;

/** Baut die Liste der Tagesberichte einer Klasse als Embed, chronologisch sortiert. */
export function buildDailyReportListEmbed(
  className: ClassName,
  reports: DailyReport[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📋 Tagesberichte - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (reports.length === 0) {
    return embed.setDescription('Aktuell sind keine Tagesberichte eingetragen.');
  }

  for (const report of reports.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [
      `Themen: ${report.topics}`,
      `📚 Lerninhalte: ${report.content}`,
      `Hinweise: ${report.notes}`,
    ];
    if (report.relatedMaterials) {
      lines.push(`Lernmaterialien: ${report.relatedMaterials}`);
    }
    lines.push(`ID: \`${report.id}\``);
    embed.addFields({ name: formatGermanDate(report.date), value: lines.join('\n') });
  }

  if (reports.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${reports.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

/** Baut die Liste der Wochenberichte einer Klasse als Embed - Aufbau analog zu buildDailyReportListEmbed(). */
export function buildWeeklyReportListEmbed(
  className: ClassName,
  reports: WeeklyReport[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📅 Wochenberichte - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (reports.length === 0) {
    return embed.setDescription('Aktuell sind keine Wochenberichte eingetragen.');
  }

  for (const report of reports.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [
      `Zeitraum: ${formatGermanDate(report.periodStart)} - ${formatGermanDate(report.periodEnd)}`,
      `Themen: ${report.topics}`,
      `📚 Lernfortschritt: ${report.progress}`,
      `Hinweise: ${report.notes}`,
      `ID: \`${report.id}\``,
    ];
    embed.addFields({ name: `KW ${report.calendarWeek}/${report.year}`, value: lines.join('\n') });
  }

  if (reports.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${reports.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

/**
 * Baut die kombinierte Berichtsheft-Ansicht (Tages- und Wochenberichte
 * gemeinsam, chronologisch sortiert) als Embed.
 */
export function buildBerichtsheftEmbed(
  className: ClassName,
  entries: BerichtsheftEntry[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📝 Berichtsheft - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (entries.length === 0) {
    return embed.setDescription('Aktuell sind keine Berichtsheft-Eintraege vorhanden.');
  }

  for (const entry of entries.slice(0, MAX_LISTED_ITEMS)) {
    const icon = entry.type === 'TAGESBERICHT' ? '📋' : '📅';
    const lines = [`Themen: ${entry.topics}`, `📚 ${entry.content}`, `Hinweise: ${entry.notes}`];
    if (entry.relatedMaterials) {
      lines.push(`Lernmaterialien: ${entry.relatedMaterials}`);
    }
    lines.push(`ID: \`${entry.id}\``);
    embed.addFields({ name: `${icon} ${entry.periodLabel}`, value: lines.join('\n') });
  }

  if (entries.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${entries.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

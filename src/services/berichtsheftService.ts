import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { listDailyReportsForClass } from './dailyReportService.js';
import { listWeeklyReportsForClass } from './weeklyReportService.js';
import { formatGermanDate } from '../utils/dateTime.js';
import type { ClassName } from '../types/domain.js';

export interface BerichtsheftEntry {
  type: 'TAGESBERICHT' | 'WOCHENBERICHT';
  id: string;
  /** Menschenlesbarer Datums-/Zeitraum-/Kalenderwochen-Bezug fuer die Anzeige. */
  periodLabel: string;
  topics: string;
  /** Lerninhalte (Tagesbericht) bzw. Lernfortschritt (Wochenbericht). */
  content: string;
  notes: string;
  relatedMaterials: string | null;
  sortKey: Date;
}

export interface BerichtsheftResult {
  className: ClassName;
  entries: BerichtsheftEntry[];
}

/**
 * Kombinierte, chronologisch sortierte Sicht auf Tages- und Wochenberichte
 * einer Klasse - die Grundlage fuer ein strukturiertes Berichtsheft. Bewusst
 * KEINE eigene Datenbanktabelle: Tages- und Wochenberichte SIND bereits die
 * Berichtsheft-Eintraege (siehe ARCHITECTURE.md), diese Funktion fasst sie nur
 * einheitlich zu einer fuer eine spaetere Export-/Ausgabefunktion geeigneten
 * Struktur zusammen. Nutzt ausschliesslich die bereits eigenstaendig
 * authentifizierten Listenfunktionen der beiden Services - keine
 * zusaetzliche/zweite Berechtigungslogik.
 */
export async function getBerichtsheftForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<BerichtsheftResult> {
  const [dailyResult, weeklyResult] = await Promise.all([
    listDailyReportsForClass(guildConfig, member, requestedClassName),
    listWeeklyReportsForClass(guildConfig, member, requestedClassName),
  ]);

  const entries: BerichtsheftEntry[] = [
    ...dailyResult.reports.map((report): BerichtsheftEntry => ({
      type: 'TAGESBERICHT',
      id: report.id,
      periodLabel: formatGermanDate(report.date),
      topics: report.topics,
      content: report.content,
      notes: report.notes,
      relatedMaterials: report.relatedMaterials,
      sortKey: report.date,
    })),
    ...weeklyResult.reports.map((report): BerichtsheftEntry => ({
      type: 'WOCHENBERICHT',
      id: report.id,
      periodLabel:
        `KW ${report.calendarWeek}/${report.year} ` +
        `(${formatGermanDate(report.periodStart)} - ${formatGermanDate(report.periodEnd)})`,
      topics: report.topics,
      content: report.progress,
      notes: report.notes,
      relatedMaterials: null,
      sortKey: report.periodStart,
    })),
  ].sort((a, b) => a.sortKey.getTime() - b.sortKey.getTime());

  return { className: dailyResult.className, entries };
}

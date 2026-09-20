import type { WeeklyReport } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface CreateWeeklyReportInput {
  guildId: string;
  classId: string;
  year: number;
  calendarWeek: number;
  periodStart: Date;
  periodEnd: Date;
  topics: string;
  progress: string;
  notes: string;
  createdByDiscordId: string;
}

export async function createWeeklyReport(input: CreateWeeklyReportInput): Promise<WeeklyReport> {
  return prisma.weeklyReport.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Berichts-ID nie serveruebergreifend Daten preisgibt. */
export async function getWeeklyReportById(
  guildId: string,
  reportId: string,
): Promise<WeeklyReport | null> {
  return prisma.weeklyReport.findFirst({ where: { id: reportId, guildId } });
}

export type WeeklyReportUpdate = Partial<
  Pick<
    WeeklyReport,
    'year' | 'calendarWeek' | 'periodStart' | 'periodEnd' | 'topics' | 'progress' | 'notes'
  >
>;

export async function updateWeeklyReport(
  reportId: string,
  data: WeeklyReportUpdate,
): Promise<WeeklyReport> {
  return prisma.weeklyReport.update({ where: { id: reportId }, data });
}

export async function deleteWeeklyReport(reportId: string): Promise<WeeklyReport> {
  return prisma.weeklyReport.delete({ where: { id: reportId } });
}

export async function listWeeklyReportsByClassId(classId: string): Promise<WeeklyReport[]> {
  return prisma.weeklyReport.findMany({
    where: { classId },
    orderBy: [{ year: 'asc' }, { calendarWeek: 'asc' }],
  });
}
